import type { Event, Policy } from 'https://gitlab.com/soapbox-pub/strfry-policies/-/raw/433459d8084d1f2d6500fdf916f22caa3b4d7be5/mod.ts';
import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";
import { NotificationStatus, Pubkey } from "./types.ts";
import { relevantPubkeysFromEvent } from "./eventUtils.ts";
import { load } from "https://deno.land/std@0.205.0/dotenv/mod.ts";

const env = await load();
const APNS_AUTH_TOKEN = env["APNS_AUTH_TOKEN"];
const APNS_SERVER_BASE_URL = env["APNS_SERVER_BASE_URL"];

const notificationSenderPolicy: Policy<void> = (msg) => {
    // Call async function to send notification without blocking
    sendNotificationsIfNeeded(msg.event);

    return {
        id: msg.event.id,
        action: 'accept',
        msg: '',
    };
};

export default notificationSenderPolicy;

const sendNotificationsIfNeeded = async (event: Event) => {
    const db = await setupDatabase();

    // 1. Determine which pubkeys to notify
    const notificationStatusForThisEvent: NotificationStatus = await getNotificationStatus(db, event.id);
    const relevantPubkeys: Set<Pubkey> = relevantPubkeysFromEvent(event);
    const pubkeysThatReceivedNotification = getPubkeysThatReceivedNotification(notificationStatusForThisEvent);
    const pubkeysToNotify = new Set<Pubkey>(
        [...relevantPubkeys].filter(x => !pubkeysThatReceivedNotification.has(x) && x !== event.pubkey)
    );
    
    // 2. Send the notifications to them
    for(const pubkey of pubkeysToNotify) {
        await sendEventNotificationsToPubkey(db, event, pubkey);
    }

    // 3. Record who we sent notifications to
    const newNotificationStatus = {
        ...notificationStatusForThisEvent,
        ...Object.fromEntries([...pubkeysToNotify].map(pubkey => [pubkey, true])),
    };
    await db.query('INSERT OR REPLACE INTO notifications (event_id, notification_status) VALUES (?, ?)', [event.id, JSON.stringify(newNotificationStatus)]);
};

const sendEventNotificationsToPubkey = async (db: DB, event: Event, pubkey: Pubkey) => {
    const userDeviceTokens = await getUserDeviceTokens(db, pubkey);

    // Send the notification to each device token
    for(const deviceToken of userDeviceTokens) {
        await sendEventNotificationToDeviceToken(event, deviceToken);
    }
};

const getUserDeviceTokens = async (db: DB, pubkey: Pubkey): Promise<Array<string>> => {
    // Get the device tokens for this pubkey
    const resultRows: Array<[string]> = await db.query('SELECT device_tokens FROM user_info WHERE pubkey = (?)', [pubkey]);

    if (resultRows.length === 0) {
        // No device tokens found for this pubkey
        return [];
        
    } else {
        const [deviceTokensJSON] = resultRows[0];
        return JSON.parse(deviceTokensJSON);
    }
}

const getPubkeysThatReceivedNotification = (notificationStatus: NotificationStatus): Set<Pubkey> => {
    return new Set<Pubkey>(
        Object.entries(notificationStatus)
            .filter(([_, receivedNotification]) => { return receivedNotification === true })
            .map(([pubkey, _]) => { return pubkey })
    );
}

const getNotificationStatus = async (db: DB, eventId: string): Promise<NotificationStatus> => {
    // Get the notification status for this event
    const resultRows: Array<[string]> = await db.query('SELECT notification_status FROM notifications WHERE event_id = (?)', [eventId]);

    if (resultRows.length === 0) {
        // No notification status found for this event, create an empty status object
        return {};
        
    } else {
        const [notificationStatusJSON] = resultRows[0];
        return JSON.parse(notificationStatusJSON);
    }
}

export const setupDatabase = async () => {
    // Open or create the database
    const db = new DB('./apns_notifications.db');

    // Create a table of notification statuses for each event
    await db.execute('CREATE TABLE IF NOT EXISTS notifications (event_id TEXT PRIMARY KEY, notification_status TEXT)');
    // Create a table of device tokens (JSON string) for each pubkey
    await db.execute('CREATE TABLE IF NOT EXISTS user_info (pubkey TEXT PRIMARY KEY, device_tokens TEXT)');

    return db;
};

function sendEventNotificationToDeviceToken(event: Event<number>,deviceToken: string) {
    // fetch(`https://api.development.push.apple.com:443/3/device/${deviceToken}`, {
    fetch(`http://localhost:8001/push-notification/${deviceToken}`, {
        method: 'POST',
        headers: {
            'authorization': `bearer ${APNS_AUTH_TOKEN}`,
            'apns-topic': 'com.jb55.damus2',
            'apns-push-type': 'alert',
            'apns-priority': '5',
            'apns-expiration': '0',
        },
        body: JSON.stringify({
            aps: {
                alert: {
                    // TODO: Improve the notification content
                    title: 'New activity',
                    subtitle: 'From: ' + event.pubkey,
                    body: event.content,
                }
            }
        }),
    });
}
