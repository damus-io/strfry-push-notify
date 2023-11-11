import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";
import { Pubkey } from "./types.ts";
import { NostrEvent } from "./NostrEvent.ts";
import { load } from "https://deno.land/std@0.205.0/dotenv/mod.ts";

const env = await load();
const APNS_SERVER_BASE_URL = env["APNS_SERVER_BASE_URL"] || "http://localhost:8001/push-notification/";
const APNS_AUTH_TOKEN = env["APNS_AUTH_TOKEN"];
const APNS_TOPIC = env["APNS_TOPIC"] || "com.jb55.damus2";

// The NotificationManager has three main responsibilities:
// 1. Keep track of pubkeys and associated iOS device tokens
// 2. Keep track of which pubkeys have received notifications for each event, so that we don't send duplicate notifications
// 3. Send notifications to the relevant iOS devices when a new event is received
export class NotificationManager {
    private dbPath: string;
    private db: DB;
    private isDatabaseSetup: boolean;

    constructor(dbPath?: string | undefined) {
        this.dbPath = dbPath || "./apns_notifications.db"
        this.db = new DB(this.dbPath);
        this.isDatabaseSetup = false;
    }

    async setupDatabase() {
        // Create a table of notification statuses for each event
        await this.db.execute('CREATE TABLE IF NOT EXISTS notifications (event_id TEXT PRIMARY KEY, notification_status TEXT)');
        // Create a table of device tokens (JSON string) for each pubkey
        await this.db.execute('CREATE TABLE IF NOT EXISTS user_info (pubkey TEXT PRIMARY KEY, device_tokens TEXT)');
        this.isDatabaseSetup = true;
    };

    throwIfDatabaseNotSetup() {
        if (!this.isDatabaseSetup) {
            throw new Error("Database not setup. Run setupDatabase() first.");
        }
    }

    async sendNotificationsIfNeeded(event: NostrEvent) {
        this.throwIfDatabaseNotSetup();
    
        // 1. Determine which pubkeys to notify
        const notificationStatusForThisEvent: NotificationStatus = await this.getNotificationStatus(event);
        const relevantPubkeys: Set<Pubkey> = event.relevantPubkeys();
        const pubkeysThatReceivedNotification = notificationStatusForThisEvent.pubkeysThatReceivedNotification();
        const pubkeysToNotify = new Set<Pubkey>(
            [...relevantPubkeys].filter(x => !pubkeysThatReceivedNotification.has(x) && x !== event.info.pubkey)
        );
        
        // 2. Send the notifications to them
        for(const pubkey of pubkeysToNotify) {
            await this.sendEventNotificationsToPubkey(event, pubkey);
        }
    
        // 3. Record who we sent notifications to
        const newNotificationStatus = {
            ...notificationStatusForThisEvent,
            ...Object.fromEntries([...pubkeysToNotify].map(pubkey => [pubkey, true])),
        };
        await this.db.query('INSERT OR REPLACE INTO notifications (event_id, notification_status) VALUES (?, ?)', [event.info.id, JSON.stringify(newNotificationStatus)]);
    };

    async sendEventNotificationsToPubkey(event: NostrEvent, pubkey: Pubkey) {
        const userDeviceTokens = await this.getUserDeviceTokens(pubkey);
    
        // Send the notification to each device token
        for(const deviceToken of userDeviceTokens) {
            await this.sendEventNotificationToDeviceToken(event, deviceToken);
        }
    };

    async getUserDeviceTokens(pubkey: Pubkey): Promise<Array<string>> {
        this.throwIfDatabaseNotSetup();

        // Get the device tokens for this pubkey
        const resultRows: Array<[string]> = await this.db.query('SELECT device_tokens FROM user_info WHERE pubkey = (?)', [pubkey]);
    
        if (resultRows.length === 0) {
            // No device tokens found for this pubkey
            return [];
            
        } else {
            const [deviceTokensJSON] = resultRows[0];
            return JSON.parse(deviceTokensJSON);
        }
    }

    async getNotificationStatus(event: NostrEvent): Promise<NotificationStatus> {
        this.throwIfDatabaseNotSetup();

        // Get the notification status for this event
        const resultRows: Array<[string]> = await this.db.query('SELECT notification_status FROM notifications WHERE event_id = (?)', [event.info.id]);
    
        if (resultRows.length === 0) {
            // No notification status found for this event, create an empty status object
            return new NotificationStatus({});
        } else {
            const [notificationStatusJSON] = resultRows[0];
            return JSON.parse(notificationStatusJSON);
        }
    }

    async sendEventNotificationToDeviceToken(event: NostrEvent, deviceToken: string) {
        const { title, subtitle, body } = this.formatNotificationMessage(event);

        await fetch(APNS_SERVER_BASE_URL + deviceToken, {
            method: 'POST',
            headers: {
                'authorization': `bearer ${APNS_AUTH_TOKEN}`,
                'apns-topic': APNS_TOPIC,
                'apns-push-type': 'alert',  // Important to allow notifications to be optionally suppressed (e.g. when the app already delivered a local notification)
                'apns-priority': '5',
                'apns-expiration': '0',
            },
            body: JSON.stringify({
                aps: {
                    alert: {
                        title: title,
                        subtitle: subtitle,
                        body: body,
                    },
                    "mutable-content": 1
                },
                nostr_event: event.info,
            }),
        });
    }

    formatNotificationMessage(event: NostrEvent): { title: string, subtitle: string, body: string } {
        // This is a very basic notification format. 
        // The idea is that the app will do the heavy lifting of formatting the notification, and this is simply a fallback in case it cannot do formatting in time.
        // The reason we put the responsibility on the client is for the following reasons:
        // 1. DM decryption can only be done on the client
        // 2. There is more infrastructure for localizing the text on the client than on the server
        // 3. Offloads the work of pulling profile names and other info to the client who probably has a copy in NostrDB
        // 4. Improves privacy by not requiring extra user info (e.g. locale) to be sent to the server
        const title = "New activity";
        const subtitle = "From: " + event.info.pubkey;
        const body = event.info.content;
        return { title, subtitle, body };
    }

    async saveUserDeviceInfo(pubkey: Pubkey, deviceToken: string) {
        this.throwIfDatabaseNotSetup();

        await this.db.query('INSERT OR REPLACE INTO user_info (pubkey, device_tokens) VALUES (?, ?)', [pubkey, JSON.stringify([deviceToken])]);
    }
}


class NotificationStatus {
    constructor(public statusInfo: Record<Pubkey, boolean>) {
        this.statusInfo = statusInfo;
    }

    pubkeysThatReceivedNotification(): Set<Pubkey> {
        return new Set<Pubkey>(
            Object.entries(this.statusInfo)
                .filter(([_, receivedNotification]) => { return receivedNotification === true })
                .map(([pubkey, _]) => { return pubkey })
        );
    }
}
