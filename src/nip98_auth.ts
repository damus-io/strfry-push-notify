import { Buffer } from 'https://deno.land/std@0.88.0/node/buffer.ts';
import crypto from 'node:crypto';
import nostr from "npm:nostr"

// TODO: Move this to nostr-js 

/**
 * Validate the authorization header of a request according to NIP-98
 * @param {string} auth_header - The authorization header of the request (`Nostr <base64_note>`)
 * @param {string} url - The url of the request
 * @param {string} method - The method of the request
 * @param {string|null|undefined} body - The body of the request
 * @returns {Promise<{authorized_pubkey: string|null, error: string|null}>} - The pubkey (hex) of the authorized user or null if not authorized, along with any error message
 */
export async function nip98_verify_auth_header(auth_header: string, url: string, method: string, body: string | null | undefined | Buffer | Uint8Array): Promise<{authorized_pubkey: string|null, error: string|null}> {
    try {
      if (!auth_header) {
        return { authorized_pubkey: null, error: 'Nostr authorization header missing' };
      }
  
      const auth_header_parts = auth_header.split(' ');
      if (auth_header_parts.length != 2) {
        return { authorized_pubkey: null, error: 'Nostr authorization header does not have 2 parts' };
      }
  
      if (auth_header_parts[0] != 'Nostr') {
        return { authorized_pubkey: null, error: 'Nostr authorization header does not start with `Nostr`' };
      }
  
      // Get base64 encoded note
      const base64_encoded_note = auth_header.split(' ')[1];
      if (!base64_encoded_note) {
        return { authorized_pubkey: null, error: 'Nostr authorization header does not have a base64 encoded note' };
      }
  
      let note = JSON.parse(Buffer.from(base64_encoded_note, 'base64').toString('utf-8'));
      if (!note) {
        return { authorized_pubkey: null, error: 'Could not parse base64 encoded JSON note' };
      }
  
      if (note.kind != 27235) {
        return { authorized_pubkey: null, error: 'Auth note kind is not 27235' };
      }
  
      let authorized_url = note.tags.find((tag: string[]) => tag[0] == 'u')[1];
      let authorized_method = note.tags.find((tag: string[]) => tag[0] == 'method')[1];
      if (authorized_url != url || authorized_method != method) {
        return { authorized_pubkey: null, error: 'Auth note url and/or method does not match request. Auth note url: ' + authorized_url + '; Request url: ' + url + '; Auth note method: ' + authorized_method + '; Request method: ' + method };
      }
  
      if (current_time() - note.created_at > 60 || current_time() - note.created_at < 0) {
        return { authorized_pubkey: null, error: 'Auth note is too old or too new' };
      }
  
      if (body !== undefined && body !== null) {
        let authorized_content_hash = note.tags.find((tag: string[]) => tag[0] == 'payload')[1];
  
        let body_hash = hash_sha256(body);
        if (authorized_content_hash != body_hash) {
          return { authorized_pubkey: null, error: 'Auth note payload hash does not match request body hash' };
        }
      }
      else {
        // If there is no body, there should be NO payload tag
        if (note.tags.find((tag: string[]) => tag[0] == 'payload')) {
          return { authorized_pubkey: null, error: 'Auth note has payload tag but request has no body' };
        }
      }
  
      // Verify that the ID corresponds to the note contents
      if (note.id != await nostr.calculateId(note)) {
        return { authorized_pubkey: null, error: 'Auth note id does not match note contents' };
      }
  
      // Verify the ID was signed by the alleged pubkey
      let signature_valid = await nostr.verifyEvent(note);
      if (!signature_valid) {
        return { authorized_pubkey: null, error: 'Auth note signature is invalid' };
      }
  
      return { authorized_pubkey: note.pubkey, error: null };
    } catch (error) {
      return { authorized_pubkey: null, error: "Error when checking auth header: " + error.message };
    }
}

function hash_sha256(data: string | Buffer | Uint8Array): string
{
	return crypto.createHash('sha256').update(data).digest().toString('hex');
}

function current_time() {
	return Math.floor(Date.now() / 1000);
}
