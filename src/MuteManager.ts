import { NostrEvent } from "./NostrEvent.ts";
import { Pubkey } from "./types.ts";
import { Relay, kinds, NostrEvent as NostrToolsEvent } from "npm:nostr-tools@2.5.2"

export class MuteManager {
    private relayUrl: string;
    private relay: Relay | undefined = undefined;

    constructor(relayUrl: string) {
        this.relayUrl = relayUrl;
        Relay.connect(this.relayUrl).then(relay => {
            this.relay = relay;
        });
    }

    async shouldMuteNotificationForPubkey(event: NostrEvent, pubkey: Pubkey): Promise<boolean> {
        const muteList = await this.getPublicMuteList(pubkey);
        if (muteList === null) {
            return false;
        }
        for(const tag of muteList.tags) {
            switch (tag[0]) {
                case 'p':
                    // Pubkey mute
                    if (event.info.pubkey === tag[1]) {
                        return true;
                    }
                    break;
                case 'e':
                    // Direct event or thread mute
                    if (event.info.id === tag[1] || event.referencedEventIds().has(tag[1])) {
                        return true;
                    }
                    break;
                case 't':
                    // Hashtag mute
                    if (event.getTags('h').includes(tag[1])) {
                        return true;
                    }
                    break;
                case 'word':
                    // Word mute
                    if (event.info.content.toLowerCase().includes(tag[1].toLowerCase())) {
                        return true;
                    }
                    break;
            }
        }
        return false;
    }

    async getPublicMuteList(pubkey: Pubkey): Promise<NostrToolsEvent|null> {
        return await new Promise((resolve, reject) => {
            const muteLists: NostrToolsEvent[] = [];
            const sub = this.relay?.subscribe([
                {
                    kinds: [kinds.Mutelist],
                    authors: [pubkey],
                    limit: 1,
                },
            ], {
                onevent(event) {
                    muteLists.push(event);
                    
                },
                oneose() {
                    sub?.close()
                    if (muteLists.length === 0) {
                        resolve(null);
                    }
                    // Get the latest mutelist. Since we only requested one, it should be the first one.
                    resolve(muteLists[0]);
                }
            })
        });
    }
}