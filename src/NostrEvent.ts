import type { Event } from 'https://gitlab.com/soapbox-pub/strfry-policies/-/raw/433459d8084d1f2d6500fdf916f22caa3b4d7be5/mod.ts';
import { Pubkey } from "./types.ts";

// This is a wrapper around the Event type from strfry-policies, which adds some useful methods
export class NostrEvent {
    constructor(public info: Event) {
        this.info = info;
    }

    referencesPubkey(pubkey: string): boolean {
        return this.referencedPubkeys().has(pubkey);
    }

    referencedPubkeys(): Set<Pubkey>{
        return new Set<Pubkey>(this.getTags('p'));
    }

    relevantPubkeys(): Set<Pubkey> {
        return new Set<Pubkey>([this.info.pubkey, ...this.referencedPubkeys()]);
    }

    referencedEventIds(): Set<string> {
        return new Set<string>(this.getTags('e'));
    }

    getTags(tagType: string): Array<string> {
        return this.info.tags.filter(tagTuple => tagTuple[0] === tagType).map(tagTuple => tagTuple[1]);
    }
}