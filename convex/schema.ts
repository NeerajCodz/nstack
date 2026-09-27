import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  oauthRequests: defineTable({
    requestId: v.string(),
    pollSecretHash: v.string(),
    expiresAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("oauth_started"), v.literal("exchanging"), v.literal("complete"), v.literal("failed")),
    stateHash: v.optional(v.string()),
    pkceVerifier: v.optional(v.string()),
    callbackClaimedAt: v.optional(v.number()),
    connectionId: v.optional(v.id("linearConnections")),
    sessionExpiresAt: v.optional(v.number()),

    deliveredAt: v.optional(v.number()),
    failureCode: v.optional(v.string())
  }).index("by_request_id", ["requestId"]).index("by_state_hash", ["stateHash"]).index("by_expires_at", ["expiresAt"]),
  linearConnections: defineTable({
    accountRef: v.string(),
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    scopes: v.array(v.string()),
    accessTokenExpiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_account_ref", ["accountRef"]),
  cliSessions: defineTable({
    tokenHash: v.string(),
    connectionId: v.id("linearConnections"),
    expiresAt: v.number(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number())
  }).index("by_token_hash", ["tokenHash"]),
  oauthStartLimits: defineTable({
    clientHash: v.string(),
    windowEndsAt: v.number(),
    count: v.number()
  }).index("by_client_hash", ["clientHash"]).index("by_window_end", ["windowEndsAt"])
});
