import { TextComponent } from "../KiberKotleta";
import fetch from "node-fetch";

const cache = {};

export function editTextComponent(c: TextComponent, source: string, target: string): TextComponent {
    if (c.text) c.text = c.text.replace(source, target);
    let extra = [];
    if (c.extra) {
        for (let i = 0; i < c.extra.length; i++) {
            let extraValue = c.extra[i];
            extra.push(editTextComponent(extraValue, source, target));
        }
        c.extra = extra;
    }
    return c;
}

export async function translateTextComponent(c: TextComponent, source: string, target: string, playerList: Array<string>, lingva: string): Promise<TextComponent> {
    console.log(`Translating: ${JSON.stringify(c)}`);
    if (!c.text && c.extra) {
        let ext = [];
        for (const extra of c.extra) {
            ext.push(await translateTextComponent(extra, source, target, playerList, lingva));
        }
        return { text: '', extra: ext, clickEvent: c.clickEvent ?? undefined, hoverEvent: c.hoverEvent ?? undefined };
    }
    if (!c.text && !c.extra) {
        return { text: '' };
    }
    //if () return c;
    if (c.text && (playerList.includes(c.text) || c.text.replace(/ /g, "").length < 1)) {
        let ext = [];
        if (c['extra']) {
            for (const extra of c.extra) {
                ext.push(await translateTextComponent(extra, source, target, playerList, lingva));
            }
            return { text: c.text, extra: ext };
        }
        return { text: c.text };
    }
    if (/^[0-9\|\\\/\-\=\+\[\]\{\}\"\'\;\:\,\.]+$/.test(c.text)) return c;
    if (/^\/[a-z0-9A-Z_\-\:]+$/.test(c.text)) return c;
    try {
        try {
            if (cache[c.text]) {
                c.text = cache[c.text];
                console.log('From cache');
            } else {
                let resp = await fetch(`${lingva}/api/v1/${source}/${target}/${encodeURIComponent(c.text)}`, {

                });
                let ctn = await resp.json();
                let spaceStart = c.text.startsWith(' ');
                let spaceEnd = c.text.endsWith(' ');
                if (spaceStart) ctn.translation = ' ' + ctn.translation;
                if (spaceEnd) ctn.translation += ' '; 
                cache[c.text] = ctn.translation;
                c.text = ctn.translation;
            }
        } catch (err) {
            console.error(err);
        }
        let extra = [];
        if (c.extra) {
            if (c.extra.length == 0) delete c.extra;
            else {
                for (let i = 0; i < c.extra.length; i++) {
                    let extraValue = c.extra[i];
                    extra.push(await translateTextComponent(extraValue, source, target, playerList, lingva));
                }
                c.extra = extra;
            }
        } //else delete c.extra;
        var d: TextComponent = {
            text: ""
        };
        d['text'] = c.text ?? "";
        if (c.selector) d['selector'] = c.selector;
        if (c.color) d['color'] = c.color;
        if (c.extra) d['extra'] = c.extra;
        if (c.hoverEvent) d['hoverEvent'] = c.hoverEvent;
        if (c.clickEvent) d['clickEvent'] = c.clickEvent;
        return d;
    } catch (err) {
        console.error(err);
    }
    return { text: "Translation error, showing original: ", extra: [c] };
}
