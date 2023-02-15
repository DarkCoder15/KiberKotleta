import { createBot, Bot } from "mineflayer";
import { Client, ServerClient, states } from "minecraft-protocol";
import { EventEmitter } from "events";
import loadPlugins from "./loadPlugins";
import Command from "./Command";
import Module from "./Module";
import getOptions, { Options } from "./Options";
import { getPlugins, TextComponent, VERSION } from "../KiberKotleta";
import PacketEvent from "./KiberKotletaPacketEvent";
import MinecraftData from "minecraft-data";

const detachedPlayers = {};

export class PlayerPosition {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
}

export class Player extends EventEmitter {

    targetClient: Bot;
    sourceClient: ServerClient;

    host: string;
    port: number;
    position: PlayerPosition;

    manualMovement: boolean;

    mcData: MinecraftData.IndexedData;

    commands: Command[];
    modules: Module[];
    plugins: any[];

    detached: boolean = false;
    detachedSince: Date;
    packetBuffer: PacketEvent[] = [];

    async detach() {
        this.detached = true;
        detachedPlayers[this.username] = this;
        this.sourceClient.end("Detached");
        this.detachedSince = new Date();
    }

    async attach(client: ServerClient) {
        this.sourceClient = client;
        //client.write('login', this.loginPacket);
        this.teleport(
            this.targetClient.entity.position.x,
            this.targetClient.entity.position.y,
            this.targetClient.entity.position.z,
            0, 0, 0x0
        );
        for (const packet of this.packetBuffer) {
            client.write(packet.name, packet.data);
        }
        this.detached = false;
        this.sendMessage(this.translate('attached', new Date(new Date().getTime() - this.detachedSince.getTime()).toLocaleTimeString()))
        this.packetBuffer = this.packetBuffer.filter(x => x.name != 'system_chat' && x.name != 'chat_message');
        delete detachedPlayers[this.username];
        client.on('packet', async (data, { name, state }) => {
            const player = this;
            const target = player.targetClient;
            try {
                if (player.detached) return;
                var packetEvent = new PacketEvent(name, state, data, 'client');
                player.emit('packet', packetEvent);
                for (const module of player.modules.filter(x => x.state)) {
                    module.emit('packet', packetEvent);
                }
                if (packetEvent.cancel) return;
                if (name == 'chat_message') {
                    if (!(await player.onChatMessage(data.message))) return;
                }
                if (['position', 'position_and_rotate', 'rotate'].includes(name)) {
                    if (!player.manualMovement) return;
                    player.position = Object.assign(player.position, data);
                    player.targetClient.entity.position.x = player.position.x;
                    player.targetClient.entity.position.y = player.position.y;
                    player.targetClient.entity.position.z = player.position.z;
                }
                if (name == 'kick_disconnect') {
                    player.sendMessage(player.translate('generic_kicked'));
                    player.sendMessage(JSON.parse(data.reason));
                    return;
                }
                if (target._client.state == states.PLAY && state == states.PLAY && name != "keep_alive")
                    target._client.write(packetEvent.name, packetEvent.data);
            } catch (error) {
                console.error(error);
                player.sendMessage({
                    text: player.translate('generic_error', error.stack)
                })
            }
        });
    }

    options: Options;

    loginPacket: any;

    get username(): string {
        return this.sourceClient.username;
    }

    get version(): string {
        return this.sourceClient.version;
    }

    teleport(x: number, y: number, z: number, yaw?: number, pitch?: number, flags?: number) {
        if (!yaw) yaw = 0;
        if (!pitch) pitch = 0;
        if (!flags) flags = 0x00;
        const d = {
            x,
            y,
            z,
            yaw,
            pitch,
            flags
        };
        if (this.detached) {
            return this.packetBuffer.push(new PacketEvent('position', null, d, 'server'));
        }
        this.sourceClient.write('position', d);
    }

    sendMessage(message: string | TextComponent | TextComponent[], prefix?: string) {

        if (typeof prefix !== "string") prefix = this.options.messagePrefix;
        if (typeof message === "string") message = {
            text: message
        };

        if (this.detached) {
            this.packetBuffer.push(new PacketEvent('system_chat', null, {
                content: JSON.stringify({ text: prefix, extra: [message] }),
                type: 1
            }, 'server'));
            return;
        } else {
            this.sourceClient.write('system_chat', {
                content: JSON.stringify({ text: prefix, extra: [message] }),
                type: 1
            });
        }

    }

    loadPlugin(plugin: Function) {
        plugin.bind(this)(this);
        this.plugins.push(plugin);
    }

    constructor(sourceClient: ServerClient, targetClient: Bot) {
        super();
        this.sourceClient = sourceClient;
        this.targetClient = targetClient;

        this.position = new PlayerPosition();
        this.manualMovement = true;
        this.plugins = [];

        this.options = getOptions(this.sourceClient.username);

        this.commands = [];
        this.modules = [];
    }

    async onChatMessage(message: string) {
        if (message.startsWith(this.options.commandPrefix)) {
            var args = message.split(' ');
            var cmd = args.shift()?.slice(this.options.commandPrefix.length);
            var command = this.commands.find(command => command.name.toLowerCase() == cmd?.toLowerCase());
            if (!command) {
                this.sendMessage(this.translate('err_no_such_command'));
                return false;
            }
            if (args.length < command.minArgsCount) {
                this.sendMessage(this.translate("err_usage", command.name + command.usage));
                return false;
            }
            try {
                if (command.execute.toString().startsWith('async (')) {
                    await command.execute(this, args);
                } else {
                    command.execute(this, args);
                }
            } catch (error) {
                console.error(error);
                this.sendMessage({
                    text: this.translate('err_command')
                });
            }
            return false;
        }
        return true;
    }

    locale() {
        try {
            return require(`../locale/${this.options.locale}.json`);
        } catch (error) {
            return require(`../../locale/${this.options.locale}.json`);
        }
    }

    translate(key, ...args) {
        var v = this.locale()[key] ?? key;
        for (const i in args) {
            v = v.replaceAll(`{${i}}`, args[i]);
        }
        return v;
    }

}

export default function inject(client: ServerClient, host: string, port: number) {

    if (detachedPlayers[client.username]) {
        const p: Player = detachedPlayers[client.username];
        p.attach(client);
        return;
    }

    const target: Bot = createBot({
        username: client.username,
        host,
        port,
        brand: "KiberKotleta " + VERSION,
        loadInternalPlugins: false
    });

    console.log(`${client.username} joined`);

    const player = new Player(client, target);

    player.mcData = MinecraftData(client.version);

    player.host = host;
    player.port = port;

    loadPlugins(player, client, target);

    getPlugins().forEach(x => {
        if (typeof x.onPlayer === "function") {
            x.onPlayer(player);
        }
    });

    target.on('move', (pos) => {
        player.teleport(pos.x, pos.y, pos.z);
    });

    target.once('spawn', () => {
        player.emit('joined');
        setTimeout(() => {
            player.sendMessage([{ text: `\n` }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#0094ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#5050ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#0094ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#5050ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#0093ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#5051ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#1a7dff" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#5051ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#3567ff" }, { "text": "█", "color": "#4f51ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#ce00f2" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#4e52ff" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#8425ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#c900f4" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#693cff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#c400f6" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#8326ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#be00f9" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#9d10ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#b900fb" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#b200ff" }, { "text": "█", "color": "#b400fd" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#d800ed" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#c100f8" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#f600df" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#cd00f2" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#ff00dc" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#da00ec" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#ff00dc" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#e600e6" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#404040" }, { "text": "█", "color": "#ff00dc" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "\n█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { "text": "█", "color": "#000000" }, { text: `\nKiberKotleta ${VERSION}` }], "");
            setTimeout(() => {
                player.sendMessage(player.translate('locale_warning'));
            }, 1000);
        }, 5000);
    });

    client.on('error', (err) => {
        console.error(err);
        player.sendMessage(player.translate('generic_connection_lost'));
    });

    client.on('packet', async (data, { name, state }) => {
        try {
            if (player.detached) return;
            var packetEvent = new PacketEvent(name, state, data, 'client');
            player.emit('packet', packetEvent);
            for (const module of player.modules.filter(x => x.state)) {
                module.emit('packet', packetEvent);
            }
            if (packetEvent.cancel) return;
            if (name == 'chat_message') {
                if (!(await player.onChatMessage(data.message))) return;
            }
            if (['position', 'position_and_rotate', 'rotate'].includes(name)) {
                if (!player.manualMovement) return;
                player.position = Object.assign(player.position, data);
                player.targetClient.entity.position.x = player.position.x;
                player.targetClient.entity.position.y = player.position.y;
                player.targetClient.entity.position.z = player.position.z;
            }
            if (name == 'kick_disconnect') {
                player.sendMessage(player.translate('generic_kicked'));
                player.sendMessage(JSON.parse(data.reason));
                return;
            }
            if (target._client.state == states.PLAY && state == states.PLAY && name != "keep_alive")
                target._client.write(packetEvent.name, packetEvent.data);
        } catch (error) {
            console.error(error);
            player.sendMessage({
                text: player.translate('generic_error', error.stack)
            })
        }
    });

    target._client.on('packet', (data, { name, state }) => {
        try {
            var packetEvent = new PacketEvent(name, state, data, 'server');
            player.emit('packet', packetEvent);
            for (const module of player.modules.filter(x => x.state)) {
                module.emit('packet', packetEvent);
            }
            if (packetEvent.cancel) return;
            if (player.sourceClient.state == states.PLAY && state == states.PLAY && name != "keep_alive")
                player.sourceClient.write(packetEvent.name, packetEvent.data);
            if ([
                'difficulty', 'teams', 'map_chunk', 'login', 'map_chunk', 'declare_commands', 'declare_recipes',
                'unlock_recipes', 'recipes_unlock', 'player_info', 'window_items', 'unload_chink', 'chunk_unload'
            ].includes(name)) {
                player.packetBuffer.push(new PacketEvent(name, state, data, 'server'));
            }
            if ((name == 'chat_message' || name == 'system_chat') && player.detached) {
                player.packetBuffer.push(new PacketEvent(name, state, data, 'server'));
            }
        } catch (error) {
            console.error(error);
            player.sendMessage({
                text: player.translate('generic_error', error.stack)
            })
        }
    });
}