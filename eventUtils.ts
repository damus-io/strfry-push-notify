import type { Event } from 'https://gitlab.com/soapbox-pub/strfry-policies/-/raw/433459d8084d1f2d6500fdf916f22caa3b4d7be5/mod.ts';
import { Pubkey } from "./types.ts";

export const relevantPubkeysFromEvent = (event: Event): Set<Pubkey> => {
    // TODO: We should add pubkeys of people to whom this event is a thread reply
    return new Set<Pubkey>([event.pubkey, ...referencedPubkeysFromEvent(event)]);
}

export const referencedPubkeysFromEvent = (event: Event): Set<Pubkey> => {
    const pubkeys = new Set<Pubkey>();

    event.tags.forEach(tagTuple => {
        const [tagType, tagValue] = tagTuple;
        if (tagType === 'p') {
            pubkeys.add(tagValue);
        }
    });

    return pubkeys;
}
