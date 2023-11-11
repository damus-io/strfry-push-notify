
import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";

const app = new Application();
const router = new Router();

// Define the endpoint for the client to send device tokens to
router.post("/push-notification/:deviceToken", async (ctx) => {
    const deviceToken = ctx?.params.deviceToken;
    const requestBody = await ctx.request.body().value
    const requestHeaders = ctx.request.headers;

    console.log(`Received push notification for device token: ${deviceToken}`);
    console.log(`Request body: ${requestBody}`);
    console.log(`Request headers: ${JSON.stringify(requestHeaders)}`);
});

app.use(router.routes());
app.use(router.allowedMethods());

console.log("Server running on port 8001");

await app.listen({ port: 8001 });
