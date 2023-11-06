#!/bin/sh
//bin/true; exec deno run -A "$0" "$@"
import {
    antiDuplicationPolicy,
    hellthreadPolicy,
    pipeline,
    rateLimitPolicy,
    readStdin,
    writeStdout,
  } from 'https://gitlab.com/soapbox-pub/strfry-policies/-/raw/433459d8084d1f2d6500fdf916f22caa3b4d7be5/mod.ts';
  import notificationSenderPolicy from "../notificationSenderPolicy.ts";
  
  for await (const msg of readStdin()) {
    const result = await pipeline(msg, [
      [hellthreadPolicy, { limit: 100 }],
      [antiDuplicationPolicy, { ttl: 60000, minLength: 50 }],
      [notificationSenderPolicy],
      [rateLimitPolicy, { whitelist: ['127.0.0.1'] }],
    ]);
  
    writeStdout(result);
  }
  