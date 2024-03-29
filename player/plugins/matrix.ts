import { VERSION } from "../../KiberKotleta";
import Command from "../Command";
import { getPlayer, Player } from "../KiberKotletaPlayer";
import * as matrix from 'matrix-js-sdk';
import { EventEmitterEvents } from "matrix-js-sdk/lib/models/typed-event-emitter";
import { EmittedEvents, MatrixCall, MatrixClient, RoomEvent, RoomMemberEvent, ClientEventHandlerMap } from "matrix-js-sdk";
import { ControlState } from "mineflayer";
import PacketEvent from "../KiberKotletaPacketEvent";
import { default as ChatMessage } from 'prismarine-chat';
import { existsSync } from 'fs';
const ansiToHtml = require('ansi-to-html');

var configPath = '../../config/matrix.json';
var config = {
    userId: '',
    token: '',
    baseUrl: ''
};
if (!existsSync(configPath)) {
    configPath = '../' + configPath;
    if (existsSync(configPath)) {
        config = require(configPath);
    }
} else {
    config = require(configPath);
}


const startTime = Date.now();

const links = {}; // User MxID -> Player Nickname
const backlinks = {}; // Player Nickname -> User MxID
const userRooms = {}; // User MxID -> Room MxID

const myUserId = config.userId;

var bot: MatrixClient;

(async () => {

    if (bot) return;
    if (!config.userId) return console.warn('Running without Matrix bot');

    bot = matrix.createClient({
        baseUrl: config.baseUrl,
        accessToken: config.token ?? undefined,
        userId: myUserId
    });

    await bot.startClient();

    // If you use Visual Studio Code and there is error on "on",
    // that says "on" function not found in MatrixClient:
    // Update VS Code.
    bot.on(RoomMemberEvent.Membership, async (event, member) => {
        if (member.membership == 'invite' && member.userId == myUserId) {
            try {
                await bot.joinRoom(member.roomId);
            } catch (error) {
                console.error(`Failed joining ${member.roomId}: ${error.stack}`);
            }
        }
    });

    bot.on(RoomEvent.Timeline, async (event, room, toStartOfTimeline) => {
        if (toStartOfTimeline) return;
        if (event.getType() != 'm.room.message') return;

        if (event.localTimestamp < startTime) return;

        let type = room.getDMInviter() ? 'directMessage' : 'room';

        const allMembers = room.currentState.getMembers();
        if (type === 'room' && allMembers.length <= 2) {
            type = 'directMessage';
        }
        if (event.sender.userId == myUserId) return;
        const content = event.getContent();
        const sender = event.event.sender;


        if (content.msgtype == 'm.text' && typeof content.body == 'string') {
            const msg = content.body;
            const args = msg.split(' ');
            const cmd = args.shift();
            userRooms[sender] = room.roomId;
            try {
                if (cmd == 'help') {
                    await bot.sendNotice(room.roomId, `request <nickname> -> request a link`);
                } else if (cmd == 'request') {
                    if (!args[0]) return await bot.sendNotice(room.roomId, `Use: request <nickname> -> request a link`);;
                    const p = getPlayer(args[0]);
                    if (!p) return await bot.sendNotice(room.roomId, `Couldn't find player: ${args[0]}`);
                    p.sendMessage(p.translate('matrix_link_request', sender, `${p.options.commandPrefix}approve ${sender}`));
                    await bot.sendNotice(room.roomId, `Link request sent`);
                } else {
                    if (!links[sender]) return;
                    const p = getPlayer(links[sender]);
                    const cl = p.targetClient;
                    if (!p) {
                        delete backlinks[links[sender]];
                        delete links[sender];
                        await bot.sendNotice(room.roomId, `Link is no longer valid`);
                        return;
                    }
                    if (cmd == 'stats') {
                        await bot.sendNotice(room.roomId, `Health: ${cl.health} | Food: ${cl.food} | Saturation: ${cl.foodSaturation}`);
                    } else if (cmd == 'move') {
                        if (!args[0]) return;
                        cl.setControlState(args[0] as ControlState, !cl.controlState[args[0]]);
                    } else if (cmd == 'hand') {
                        if (!args[0]) return;
                        const i = cl.inventory.items().find(x => x.name == args[0]);
                        if (!i) return await bot.sendNotice(room.roomId, `Couldn't find item: ${args[0]}`);
                        await cl.equip(i, 'hand');
                    } else if (cmd == 'consume') {
                        if (!args[0]) return;
                        await cl.consume();
                    } else if (cmd == 'items') {
                        await bot.sendNotice(room.roomId, `${cl.inventory.items().map(x => `${x.name} x ${x.count}`).join(', ')}`);
                    } else {
                        const c = await p.onChatMessage(msg);
                        if (c) cl.chat(msg);
                    }
                }
            } catch (err) {
                console.error(err);
            }
        }
    });

})();

export default async function matrixPlugin(player: Player) {
    var msgs = [];

    player.on('packet', async (ev: PacketEvent) => {
        if (ev.source == 'client') return;
        if (ev.name != 'chat_message' && ev.name != 'system_chat') return;
        if (ev.data.type == 2) return;
        const msg = new (ChatMessage(player.targetClient.version))(JSON.parse(ev.data.content));
        if (!backlinks[player.username]) return;
        var m = new ansiToHtml().toHtml(msg.toAnsi().replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        m = m.replace(/<\/span>/g, "</font>");
        m = m.replace(/<span style="color:/g, "<font color=\"");
        msgs.push(m);
    });

    setInterval(async () => {
        if (!backlinks[player.username] || !userRooms[backlinks[player.username]] || msgs.length < 1) return;
        await bot.sendHtmlMessage(userRooms[backlinks[player.username]], msgs.join('\n'), msgs.join('<br>\n'));
        msgs = [];
    }, 1000);

    player.commands.push(
        new Command(
            'approve',
            player.translate('cmd_approve_desc'),
            player.translate('cmd_approve_usage'),
            1,
            async ({ }, args: string[]) => {
                player.isLinkedToMatrix = true;
                links[args[0]] = player.username;
                backlinks[player.username] = args[0];
                if (userRooms[args[0]]) {
                    await bot.sendNotice(userRooms[args[0]], `Link approved`);
                }
            }
        )
    );
}