import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { privatePhotoChild, retainedAvatar } from "../src/services/profilePhotos.js";
import { createSignedAclUrl } from "../src/services/spaces.js";

Object.assign(config, { spacesKey: "test", spacesSecret: "test-secret", spacesBucket: "test-bucket",
  spacesRegion: "lon1", spacesEndpoint: "https://lon1.digitaloceanspaces.com",
  spacesPublicUrl: "https://test-bucket.lon1.digitaloceanspaces.com" });
const child = "11111111-1111-4111-8111-111111111111";
const original = `${config.spacesPublicUrl}/families/family/children/${child}/profile-123.png`;

test("authorised child output uses an expiring URL and does not alter storage reference", () => {
  const result = privatePhotoChild({ id: child, avatarUrl: original });
  assert.equal(new URL(result.avatarUrl).searchParams.get("X-Amz-Expires"), "3600");
  assert.equal(retainedAvatar(result.avatarUrl, original, child), original);
});
test("cannot substitute another child's photo or external URL", () => {
  assert.equal(privatePhotoChild({ id: "other-child", avatarUrl: original }).avatarUrl, null);
  assert.throws(() => retainedAvatar("https://example.com/image.png", original, child));
  assert.throws(() => retainedAvatar(original.replace("profile-123", "profile-456"), original, child));
});
test("photo removal is allowed and ACL signer rejects public access", () => {
  assert.equal(retainedAvatar(null, original, child), null);
  assert.throws(() => createSignedAclUrl({ objectKey: "anything", acl: "public-read" }));
});
