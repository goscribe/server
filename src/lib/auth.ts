/**
 * Authentication utilities for custom HMAC-based cookie verification.
 * 
 * This module provides secure authentication using HMAC-SHA256 signatures
 * to verify user identity through signed cookies.
 * 
 * @fileoverview Custom authentication system with HMAC cookie verification
 * @author Scribe Team
 * @version 1.0.0
 */

import crypto from "node:crypto";

/**
 * Represents the result of successful authentication verification.
 */
export interface AuthResult {
  /** The authenticated user's unique identifier */
  userId: string;
}

/**
 * Configuration for the authentication system.
 */
interface AuthConfig {
  /** The secret key used for HMAC signing */
  secret: string;
}

/**
 * Verifies a custom HMAC-signed authentication cookie.
 * 
 * The cookie format is: `base64(userId).hex(hmacSHA256(base64(userId), secret))`
 * 
 * @param cookieValue - The raw cookie value to verify, or undefined if no cookie exists
 * @returns Authentication result with userId if valid, null if invalid or missing
 * 
 * @example
 * ```typescript
 * const result = verifyCustomAuthCookie("dXNlcjEyMw.abc123def456...");
 * if (result) {
 *   console.log(`Authenticated user: ${result.userId}`);
 * }
 * ```
 * 
 * @throws {Error} Never throws - returns null for all error conditions
 */
export function verifyCustomAuthCookie(cookieValue: string | undefined): AuthResult | null {
  // Early return for missing cookie
  if (!cookieValue) {
    return null;
  }
  
  // Get authentication secret from environment
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return null;
  }

  // Parse cookie format: base64UserId.signatureHex
  const parts = cookieValue.split(".");
  if (parts.length !== 2) {
    return null;
  }
  
  const [base64UserId, signatureHex] = parts;

  // Decode the user ID from base64url encoding
  const userId = decodeBase64UrlUserId(base64UserId);
  if (!userId) {
    return null;
  }

  // Verify the HMAC signature
  const isValidSignature = verifyHmacSignature(base64UserId, signatureHex, secret);
  if (!isValidSignature) {
    return null;
  }

  return { userId };
}

/**
 * Decodes a base64url-encoded user ID string.
 * 
 * @param base64UserId - The base64url-encoded user ID
 * @returns The decoded user ID string, or null if decoding fails
 * 
 * @private
 */
function decodeBase64UrlUserId(base64UserId: string): string | null {
  try {
    const buffer = Buffer.from(base64UserId, "base64url");
    return buffer.toString("utf8");
  } catch (error) {
    return null;
  }
}

/**
 * Verifies an HMAC-SHA256 signature against the expected value.
 * 
 * @param data - The data that was signed (base64url-encoded user ID)
 * @param signatureHex - The hex-encoded signature to verify
 * @param secret - The secret key used for signing
 * @returns True if the signature is valid, false otherwise
 * 
 * @private
 */
function verifyHmacSignature(data: string, signatureHex: string, secret: string): boolean {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(data);
  const expectedSignature = hmac.digest("hex");
  
  return timingSafeEqualHex(signatureHex, expectedSignature);
}

/**
 * Performs a timing-safe comparison of two hex-encoded strings.
 * 
 * This function prevents timing attacks by ensuring the comparison
 * takes the same amount of time regardless of where the strings differ.
 * 
 * @param a - First hex string to compare
 * @param b - Second hex string to compare
 * @returns True if the strings are equal, false otherwise
 * 
 * @private
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const bufferA = Buffer.from(a, "hex");
    const bufferB = Buffer.from(b, "hex");
    
    // Length check prevents timing attacks on different-length inputs
    if (bufferA.length !== bufferB.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(bufferA, bufferB);
  } catch {
    // Return false for any parsing errors
    return false;
  }
}
