import { Module, VERSION } from "../../KiberKotleta";
import Command from "../Command";
import PacketEvent from "../KiberKotletaPacketEvent";
import { Player } from "../KiberKotletaPlayer";
import moment from "moment";
import { translateTextComponent } from "../../util/textComponent";

export default function chatPlugin(player: Player) {

    var timeChatModule = new Module("TimeChat", "Время около сообщений в чате", player);

    timeChatModule.on('packet', (packet: PacketEvent) => {
        if (packet.source == 'server' &&
            ['chat_message', 'system_chat'].includes(packet.name) &&
            [1, 0, 7, 3, 4, 5].includes(packet.data.type)) {
            packet.data.content = JSON.stringify({
                "text": `§7[${moment().format("HH:mm:ss")}]§r `,
                "extra": [
                    JSON.parse(packet.data.content)
                ]
            });
        }
    });

    var translateChatModule = new Module("Translate", "Перевод сообщений в чате", player);
    if (!player.options.hasModule('Translate')) {
        player.options.setModuleOptions('Translate', {
            from: 'auto',
            to: 'ru'
        });
    }
    var translatorSettings = player.options.getModuleOptions("Translate") ?? {
        from: 'auto',
        to: 'ru'
    };

    translateChatModule.on('packet', (packet: PacketEvent) => {
        if (packet.name == 'chat_message') {
            console.log(JSON.stringify(packet));
        }
        if (packet.source == 'server' &&
            ['chat_message', 'system_chat'].includes(packet.name) &&
            [1, 0, 7].includes(packet.data.type)) {
            var tc = JSON.parse(packet.data.content);
            console.log(`Original: ${JSON.stringify(packet)}`);
            packet.cancel = true;
            translateTextComponent(tc, translatorSettings.from, translatorSettings.to, Object.keys(player.targetClient.players)).then(data => {
                console.log(`Translated: ${JSON.stringify(data)}`);
                player.sourceClient.write('system_chat', {
                    sender: packet.data.sender ?? '0',
                    type: packet.data.type ?? 1,
                    content: JSON.stringify(data)
                });
            });            
        }
    });

    player.commands.push(
        new Command(
            "translate_test",
            "Проверка переводчика в рантайме",
            "",
            0,
            async () => {
                await player.sendMessage(await translateTextComponent({
                    text: "Hello. If you see this text and it is in Russian, module should work fine."
                }, "en", "ru", []));
            }
        )
    );

    player.modules.push(timeChatModule);
    player.modules.push(translateChatModule);

}