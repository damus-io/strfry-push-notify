
import { Application, Router, Context } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { NotificationManager } from "./NotificationManager.ts";


const app = new Application();
const router = new Router();



// Define the endpoint for the client to send device tokens to
router.post("/user-info", async (ctx: Context) => {
    console.log("Received POST request to /user-info");
    const body = await ctx.request.body();
    const bodyValue = await body.value;
    console.log(bodyValue);
    const { deviceToken, pubkey } = bodyValue

    console.log(`Received device token ${deviceToken} for pubkey ${pubkey}`)
    const notificationManager = new NotificationManager();
    await notificationManager.setupDatabase()
    notificationManager.saveUserDeviceInfo(pubkey, deviceToken);
    ctx.response.body = "User info saved successfully";
});

app.use(router.routes());
app.use(router.allowedMethods());

console.log("Server running on port 8000");

await app.listen({ port: 8000 });
