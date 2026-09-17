# Preview storage and recovery review

Date: 2026-09-17 (Asia/Seoul). Owner: independent SRE/Optimizer. This is a metadata and source review for the approved real Google login / administrator-save Preview check. It is not a deployment result or approval to write production business data.

## Verdict

The existing Vercel Preview environment is **not isolated for writes**. The Architect's environment inventory shows that Preview and Production share the same Redis credentials entry and Supabase service-role entry. Operations uses fixed Redis keys, so a normal Preview deployment with inherited credentials could change production operations records.

The approved minimum is a **temporary, separate Redis database for synthetic business data, using the existing BCC Google identity service**. This is suitable for the narrow administrator-save check after the conditions below are verified. It is not full Auth isolation: real login uses the shared Auth service and may create or update sessions and login records. Only existing, authorized accounts are in scope; no signup, profile mutation, user administration, payment purchase, live collector or production business-data query is part of this test.

At this document revision, the SRE has not provisioned Redis, deployed Preview, opened an authenticated browser session, saved a hosted record, or verified an external alert. Provisioning and deployment are the Architect's work; their results must be recorded separately before marking the corresponding checks complete.

## Read-only evidence

Supabase connector project metadata was read without SQL, table reads, user reads, Auth-setting changes or resource creation:

| Resource | Project ref | Region | Observed state |
| --- | --- | --- | --- |
| `bcc-business` | `jhjxrkypnigcohgnzhvq` | `ap-northeast-2` | `ACTIVE_HEALTHY`; `list_branches` returned an empty list |
| `yerim-personal` | `epyaaenpnljoqycccesz` | `ap-northeast-1` | `ACTIVE_HEALTHY`; unrelated existing project, not approved for reuse |

Both projects belong to organization `gxrahbyrdijazbfaramn`. No separate project labeled Preview or existing BCC development branch was found. The unrelated project's branches and user data were not investigated. No new Supabase project/branch, subscription or paid resource was requested.

The Architect owns Vercel access and supplied this environment-name metadata; SRE did not duplicate the listing or read credential values:

| Environment name | Architect's observed scope | Consequence |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Each has one shared Preview/Production entry; no Preview-specific override | Existing Preview would use the same Redis instance |
| `SUPABASE_SERVICE_ROLE_KEY` | One shared Production/Preview entry | Existing Preview can reach the same privileged business-data client unless overridden/disabled |
| `NEXT_PUBLIC_SUPABASE_URL` | Separate Preview and Production entries; value equality not checked | Separate entries alone do not establish separate resources |

Direct source checks:

- `lib/operations/storage.ts` uses `gp:operations:v1:${month}` with the generic Upstash environment names. GET reads that key; EVAL atomically compares revision and sets the next document. A Preview label or different month does not provide a storage security boundary. A separate database avoids needing a source change to the frozen candidate.
- `app/api/operations/route.ts` authenticates via `getGoogleUser`; `lib/auth/googleUser.ts` verifies the token against the shared BCC Auth user endpoint and recognizes trusted `app_metadata` or deployment `ADMIN_EMAILS`. The route does not require a Supabase service-role credential to store operations data.
- `lib/auth/config.ts` hardcodes the BCC Auth project. `components/auth/AuthGate.tsx` uses it for Google OAuth and constructs `redirectTo` from the current origin, pathname and query. Environment overrides to the business-data client do not isolate Auth.
- AuthGate calls `/api/order/verify` after login. Non-admin verification can inspect/claim records in Redis, which is another reason to replace the entire Redis instance, rather than only choose a synthetic operations month.
- `app/api/auth/signup/route.ts` posts to a hardcoded BCC signup upstream. Clearing service-role or AI credentials does not disable this endpoint. Keep the Preview access protected and restrict this check to existing-account Google login; do not submit the signup form or invoke that proxy.
- `lib/supabase/admin.ts` gets its URL and service-role key from environment variables. The administrator operations flow does not need this business-data client. Preview-only removal or invalidation must be verified before any broader navigation.
- `OPS_LOCAL_MODE` storage is only allowed when `NODE_ENV=development`. The hosted check must use the production build with this local bypass off.

## Temporary Redis option and cost boundary

Official Upstash documentation describes a free, no-account development database created by `POST https://upstash.com/start-redis`, expiring after 72 hours. The endpoint returns credentials; the Architect will provision at most one instance and keep the response in the private, ignored `.local/preview-release` location without printing credentials. The documentation requires an identifying User-Agent. SRE only read the documentation and did not call the provisioning endpoint. [Upstash CLI documentation](https://upstash.com/docs/agent-resources/cli), [Getting started](https://upstash.com/docs/redis/overall/getstarted).

Record the creation time and actual expiry metadata, or clearly label an expiry calculated as creation plus 72 hours. Confirm the new resource/endpoint differs from production using a boolean/resource-metadata comparison, never a token dump. Use only synthetic operations values; Auth-derived audit actor IDs may still identify the authorized test account. Keep any exported test records private. Do not claim the database, enable paid features, attach billing or retain it as production storage without separate approval and a current cost check.

Expiration is expected teardown, not a recovery mechanism. Complete verification before expiry, export only the needed private evidence, and retire the temporary deployment afterwards. Once the resource expires, storage/payment-check requests can fail and that deployment is no longer a valid review environment. Do not fall back to production credentials to keep it working.

A separate permanent Redis or Supabase project/branch is not required for this narrow approved scenario. If full Auth isolation or durable staging becomes necessary, choose the organization and resource first, obtain current cost information, and get explicit approval before creation; no price or free allowance is assumed here.

## Conditions before real login or save

1. Record the exact candidate commit/source manifest, Preview deployment ID and URL. Verify no source drift between the tested candidate and deployment. This document does not alter historical manifests or benchmark results.
2. Set deployment-specific Redis URL/token to the temporary resource and verify that no production credential fallback remains. Confirm the actual token supports GET, SET and EVAL using a synthetic key only in that new database. A local Redis integration pass does not prove the hosted token's ACL or network reachability.
3. Disable or invalidate deployment-only Supabase service-role, payment/webhook/forwarding, cron, GAS and external AI credentials as identified by the Architect/Implementation. Verify the deployed values' presence/scope without logging their values. Keep production configuration untouched. This is a preparation requirement, not a statement that these overrides have already happened.
4. Keep Preview deployment access protection enabled. Use the approved existing Google account and deployment-specific administrator authorization. Leave local-mode and unrelated scale/queue activation flags off. Avoid signup, payment, collection and lead-submission routes.
5. Confirm the actual Google `redirectTo` returns to the exact Preview operations page. Supabase requires `redirectTo` to match its configured allowlist; wildcard rules can cover Preview URLs, but no rule was observed here. The available Supabase connector exposes no Auth configuration/redirect-allowlist read method. No settings were changed, and permission to add a URL is not assumed. [Supabase redirect URL documentation](https://supabase.com/docs/guides/auth/redirect-urls).

## Real-save verification and recovery procedure

The following remains to be executed against the exact protected Preview; it is not a list of completed checks:

1. Verify unauthenticated GET/PUT produce 401. With an authorized existing ordinary Google account, verify 403. Record status, timestamp and request ID without capturing tokens or unrelated account data.
2. Sign in as the approved administrator and load a clearly synthetic test month. Privately save its initial document or explicit absent-state evidence, schema version and revision. Do not copy a production month.
3. Save one synthetic command through the normal UI. Confirm success, revision increment and the expected summary. Reload and verify the same result through the authenticated read path; a success toast alone does not prove persistence.
4. Send two bounded writes from the same starting revision in the isolated environment. Verify exactly one succeeds and one returns 409, then reload to confirm the winner. Preserve each request ID and status.
5. With an explicitly bounded fault in a temporary check deployment or isolated test credential, verify 503, retained UI input and safe request logging. Do not disrupt the successful candidate or shared resource to simulate failure. Restore the temporary configuration and confirm a read succeeds again.
6. Reverse the synthetic change through the normal authorized mutation path and recheck revision/summary. Preserve any needed private test evidence before the database expires. Do not claim a provider-level backup restore drill based on this logical reversal.

Record the previous stable deployment ID and rollback command before any later production promotion. Runtime rollback alone does not undo data writes. A production storage backup/restore plan must separately establish the exact database, export or snapshot, restoration permissions, schema/revision handling and a tested recovery result. The last 100 audit entries in a month document are not a full backup.

## Observability status and limits

The source emits operations metadata with `event`, `requestId`, `method`, `phase`, `status` and `durationMs`; responses include `X-Request-ID`. The bounded record excludes user identifiers, payloads, URLs and raw exceptions. Logging failure is caught so it does not turn a completed write into an apparent write failure. Payment and collector logging was separately covered in the release review.

No external alert destination, log drain, metrics backend, on-call delivery or provider backup was configured or tested by this investigation. Before production approval, connect the chosen destination and prove one bounded error notification arrives with a usable request/run ID, then resolves. Cron HTTP 200 alone does not prove successful collection because a partial result can carry `ok:false`.

The existing local integration tests and historical performance artifacts remain evidence for their recorded source versions and controlled scenarios. They do not establish hosted Redis ACL, Google redirect behavior, external alert delivery, durable staging capacity or production recovery. This SRE phase ran no benchmark, stress workload, production query, browser flow or user-data inspection.
