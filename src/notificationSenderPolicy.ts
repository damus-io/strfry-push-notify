import type { Policy } from 'https://gitlab.com/soapbox-pub/strfry-policies/-/raw/433459d8084d1f2d6500fdf916f22caa3b4d7be5/mod.ts';
import { NotificationManager } from "./NotificationManager.ts";
import { NostrEvent } from "./NostrEvent.ts";

interface NotificationSenderPolicyOptions {
    rejectEvents?: boolean;
}

// This is the strfry-policies policy that sends notifications.
// To use this, just add this to your policy pipeline.
const notificationSenderPolicy: Policy<NotificationSenderPolicyOptions> = (msg, options) => {
    // Set things up
    const nostrEvent = new NostrEvent(msg.event);
    const notificationManager = new NotificationManager();

    // Call async function to send notifications without blocking
    notificationManager.setupDatabase().then(() => {
        notificationManager.sendNotificationsIfNeeded(nostrEvent);
    });

    // Passthrough (do not try to filter the event)
    return {
        id: msg.event.id,
        action: options?.rejectEvents ? 'shadowReject' : 'accept',
        msg: '',
    };
};

export default notificationSenderPolicy;
