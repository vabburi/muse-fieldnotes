# muse-fieldnotes

Field notes that keep the *why*. These are job close-outs for home-service technicians, built on Meta's models for the Meta Global AI Developer Hackathon. The build window is Oct 26 – Nov 4, 2026, and this is a startup track entry under the "Build for Your World" theme.

A technician's photos, voice notes and messages from a job become a close-out note: Found / Done / Parts / Quoted / Why / Follow-up / Notes. Each line cites the evidence it rests on. Clicking a citation highlights what the technician pointed at in the photo.

When the technician recommends a repair or replacement, the same evidence follows the job to the comfort advisor. The advisor gets a homeowner-ready proposal where every claim shows the real photo behind it and the technician's own words for why. One evidence chain, from the attic to the kitchen table.

## Ground rules for this repo

- **No real customer data.** No real customers, technicians, job numbers or addresses; the job records are invented. job-003's photos are real equipment from our own shop, with serial numbers, barcodes and QR codes redacted and photo metadata stripped, and its voice note is the founder's own voice, used with permission.
- **Nothing from private repos.** Under the event waiver, shared materials are non-confidential, and the organizers get a perpetual license to submissions. Everything here is new work written for this project.
- **No secrets in git.** API keys go in `.env`, which is git-ignored.
- **Implementation starts at kickoff (Oct 26).** Until then, this README is the plan.
- **The repo must be public** for judging (event rule), so keep it clean from the first commit.

## Event facts (from the participant guide, all times ET)

- **Kickoff:** Mon Oct 26, 12:00 PM. **Submissions due:** Wed Nov 4, 9:00 PM, on the Cerebral Valley platform. Late submissions are not considered.
- **Submission:** public repo, a **3-minute** demo video, and the live product. Judges use all three. The demo may only show work built during the hackathon, and we must clearly mark what is new.
- **Judging:** Stage 1 is pass/fail (fits the theme, really uses Meta's models). Stage 2 scores four **equally weighted** criteria, 0–10 each: Impact · Use of Meta AI tooling · Technical depth & execution · Demo. Stage 3: the top 5 per track are ranked live at the closing ceremony (Mon Nov 9, 12:00 PM).
- **Startup track:** "technical execution and whether it holds up in production." Prizes are $250K / $150K / $75K / $50K / $25K.
- **Bonus prizes:** Most Viral on X $20K (engagement through Nov 8) · Best Build on Meta Open Weight Models $10K (Muse Glimmer or Muse Spark Open) · Community Vote $10K · Best Agentic Use-Case $5K · Best Creative Build $5K (Muse Image or Muse Wonder; not our fit).
- **Models:** Muse Spark series, Muse Wonder, Muse Image, Muse Voice Transcribe and SAM 3.1 via Meta Model API. Open weights: Muse Glimmer and Muse Spark Open (on Baseten use `meta-models/muse-spark-open-1026`). Muse Code for coding.
- **Anti-projects to steer clear of:** "basic RAG applications" and "simple image analyzers". The pitch and demo must make it obvious this is a verifiable agent workflow, not either of those.
- **The video is the product for judging.** Stage 2 scores largely from the 3-minute video, and in Stage 3 the final judges watch the videos live on Nov 9 and rank them. Treat it as the main deliverable, not the last task.
- **Submission checklist (kickoff slides):** submit on the CV platform with every teammate listed; 3-minute video showing only what we built during the event; public GitHub repo that opens in a logged-out browser; don't wait for the last hour.
- **Credits:** $150 Meta Model API, claimed Oct 26. API calls need a card on the account, so add one and set a spend limit. While on free credits, Meta may use our content for product improvement, which is fine for synthetic data but not for real customer data. Partner credit forms are posted in Discord #resources. Baseten $100 + 2M TPM (first 2,000, reviewed), Modal $100 (first 1,000), Fireworks $25 (shortlisted teams).
- **Sessions (12–1 PM):** Oct 27 Agents 101 · Oct 28 Agents 102: Verifiable Agents · Oct 30 Fireworks / Muse open models. Discord office hours weekdays 10–11 AM in #office-hours.
- **Team:** up to 4 people. One person is the Representative who submits.

## How we win 1st in the startup track

**Thesis.** In home services, the money is in the recommendation: a repair quote, a replacement, a maintenance plan. Two things break it today. The technician's *why* is lost between the job and the office, and the homeowner doesn't trust an upsell they can't see. We make every recommendation carry its proof. That is a narrow, real pain with a clear buyer (the shop owner), and it is something only multimodal models plus pixel-level segmentation make possible. That fits "make something possible that wasn't before."

Startup-track judges ask "is this a real product, and does it hold up in production?" So we show a real shop that wants it, a deployed product that survives judges clicking on it, and numbers.

**Setup:** solo build. Ray-Ban Meta glasses on hand. One HVAC shop as the design partner. The submission is under the muse-fieldnotes name only, with no company branding.

### Product: one evidence chain, three assistants

| Assistant | For | What it does | Meta models |
|---|---|---|---|
| Tech assistant | Technician on site | Hands-free capture from Ray-Ban Meta glasses (phone as fallback). Reads equipment nameplates. Asks a follow-up when evidence is missing instead of guessing. | Muse Spark, Muse Voice Transcribe, Wearables toolkit |
| Close-out agent | Technician and office | Cited close-out, verified line by line, with the cited part highlighted in each photo. | Muse Spark, Muse Spark Open (verifier), SAM 3.1 |
| Advisor assistant | Comfort advisor | One page per recommendation: an advisor view (handoff brief) and a homeowner view (evidence cards: real photo + mask + the tech's words). | Muse Spark, SAM 3.1 |

Cut for a solo build: pre-visit brief, follow-up message drafts, the Glimmer fine-tune. They return only if P0 and P1 are done early.

**Guardrails** (also our production story):
- A human approves before anything reaches a homeowner.
- No generated images as evidence. Every picture a homeowner sees is a real job photo, which is why we don't use Muse Image or Muse Wonder.
- No safety or diagnostic advice beyond what the technician recorded.
- Prices come from the shop's price book, never from the model.

### How the close-out agent works

Built on the pattern from the Agents 101/102 workshops (`meta-models/legal-agent-workshop`). Muse Spark runs a loop on the Meta Responses API: each turn it says what it is doing, calls one tool, and gets the result back. The checks live inside the tools, so the agent cannot skip them (`src/lib/agent/`).

| Tool | What it does | Checks inside it | On failure |
|---|---|---|---|
| `read_nameplates` | Reads rating plates in photos into citable sources | | |
| `set_checklist` | One entry per item of the shop's close-out checklist for the call type: found (cited), ask (a question) or not applicable | Code: every shop item covered (100%), cited sources exist, numbers appear in them. Then Muse Spark Open judges each entry against all sources | Refused with the problems; after 3 refusals accepted with the problems kept for the office |
| `ask_tech` | Asks the technician about items marked ask | Item is marked ask, not already asked, at most 4 questions, at most 2 rounds | Refused; otherwise the run pauses until the technician answers. Answers become sources |
| `submit_note` | Submits the cited note | Code: every found or answered checklist item is cited by a line; numbers in each line appear in its sources. Then Muse Spark Open checks each line against only its cited sources | Refused with the problems; after 3 refusals escalated to the office |
| Office sign-off | Approve, or send back with notes | | Notes go back to the agent |

The shop's checklist (`src/lib/agent/checklist.ts`) is the ground truth, set by the shop, not the model. It is a synthetic stand-in until the design-partner shop sends its real list. The one-pass close-out stays as a fast mode.

Runs after the review fixes (Oct 29), all approved by the office with every line verified:

| Job | Turns | Refused by the checks | Questions (answered) | Time | Tokens |
|---|---|---|---|---|---|
| job-001 (no heat) | 6 | checklist 1, note 2 | none needed | 86 s | 90k |
| job-002 (no cool) | 7 | checklist 3 | 4 (1) | 66 s | 44k |
| job-003 (two systems) | 8 | checklist 2, questions 1 | 4 (3) | 69 s | 187k |

Unanswered questions go to the office as open questions on the note. Runs and caches live in Upstash Redis when deployed (every server instance sees the same run while the agent works, the page polls and answers arrive) and in `.cache/` files locally. Photos are saved in a run as references, not data, so a run is about 65 KB. Anyone with the link can read jobs and notes; running the agent, answering, signing off, re-checking a line and computing a new photo highlight need the demo passcode (`DEMO_PASSCODE`).

### One move per criterion (each is 25%)

1. **Impact.** Go deep with our one HVAC shop rather than wide: talk to the owner, at least two technicians and the comfort advisor. Get a written pilot commitment from the shop, and a shadow test on Nov 2 where a technician uses it on real work. Put their words and one number in the video: minutes per close-out, callbacks, or the advisor close rate on tech-sourced leads. Show who pays and the pricing line.
2. **Use of Meta AI tooling.** Five Meta models plus Ray-Ban Meta glasses, each doing what it is uniquely good at. The glasses capture hands-free, which technicians on ladders and in attics genuinely need; Muse Spark reads mixed media and nameplates; SAM 3.1 turns a citation into a pixel-level highlight; Muse Voice Transcribe captures the Why; Muse Spark Open verifies; Muse Code builds it.
3. **Technical depth.** A multi-agent workflow with a verifier, follow-up questions, provider failover, evals with published numbers, and cost per job. This is also our case for Best Agentic Use-Case.
4. **Demo.** A live URL that holds up and a 3-minute video that is cool to watch (script below).
5. **Bonus prizes.** Post a 30–45 second cut on X on Nov 4 and push engagement through Nov 8 (Most Viral, $20K). Push the gallery vote (Community Vote, $10K).

### Testing with technicians

The tech assistant is a mobile web page (no app install): a private link plus a shop passcode, saved to the phone's home screen. On a job the tech adds photos from the camera, voice notes recorded in the browser and quick typed notes, then taps **Close out**.

1. **Round 1, Oct 31 – Nov 1:** one or two techs at our shop use it on a few real jobs, alongside their normal paperwork. They mark each line ✓ or ✗ and leave one comment.
2. **Round 2, Nov 2:** the filmed shadow test, with round 1's problems fixed.

**We measure:** minutes per close-out versus their normal way; the share of lines marked ✓; whether the Why says what they meant; and "would you want the office or the comfort advisor to get this note?"

**Rules for real jobs:**
- Every uploaded photo is re-encoded with its metadata stripped (phone photos carry GPS).
- No customer names or addresses: jobs are "Job 1, Job 2", and techs don't photograph faces or the house exterior.
- Standard models only, never `-contributor`. For the real-job rounds, switch billing off free credits, since free-credit content may be used for product improvement.
- Test data lives in private storage (Vercel Blob), not in the repo, and is deleted after the hackathon. Only metrics and approved quotes are kept.
- The shop owner approves all of the above before round 1.

### The 3-minute video (draft)

| Time | Beat |
|---|---|
| 0:00–0:20 | The problem: the tech's *why* dies in the truck, and the homeowner doesn't trust the upsell. |
| 0:20–1:10 | On site: glasses POV capture at the shop → the close-out builds itself with citations → click `[2]` and the mask lights up on the failed part. |
| 1:10–1:40 | Trust: the verifier catches a made-up line live, and the agent asks the tech a follow-up instead. |
| 1:40–2:30 | Handoff: the advisor gets the brief; the homeowner proposal shows the real photo, the mask and the tech's own words. |
| 2:30–3:00 | Proof: eval numbers, cost per job, design partners, and what was built during the hackathon. |

### Priorities (cut from the bottom)

- **P0:** phone-usable capture (photos, voice notes, text) → cited close-out → verifier → SAM evidence view → private storage for test jobs → deployed URL.
- **P1:** Ray-Ban glasses capture into the job thread. Advisor and homeowner proposal page.
- **P2:** Modal failover. Polish.
- **Cut unless far ahead:** pre-visit brief, follow-up message drafts, Glimmer fine-tune on Fireworks.

### Risks

- **Scope, solo.** P0 must be deployed by Oct 30 before any P1 work starts. Use Muse Code to move faster and say so in the README.
- **Wearables toolkit.** No approval needed to build: turn on Developer Mode in the Meta AI app and add the SDK from GitHub (iOS or Android). This means building a small companion mobile app. Timebox a 2-hour spike on Oct 27. If the toolkit isn't workable, capture with the glasses' own photo and video, sync through the Meta AI app and upload into the job thread. The video still gets the POV shot.
- **Real data at the shop.** The repo stays synthetic. See "Testing with technicians" for the rules on real jobs; nothing from them is committed, and the shop agrees to what we film and quote.
- **A weak video sinks a strong build.** Storyboard on Oct 28, build what the storyboard needs, and make a rough cut on Oct 31 to find gaps while there is still time to fix them.
- **Looking like an "image analyzer".** Lead every pitch with the evidence chain and the agent workflow, never with "upload a photo".
- **Homeowner-facing claims.** Guardrails above, and the verifier runs on the proposal too.
- **One design partner.** Make it deep: several roles at the shop, a written pilot commitment and a real shadow test.

## Inference partners

Status (Oct 27): credits applied on all three: Baseten $100, Fireworks $100, Modal $100. The verifier is live in the close-out (`src/lib/verifier.ts`) and fails over Baseten → Fireworks → Modal (`src/lib/spark-open.ts`); each host is used once its key is in `.env`. Seeded eval lines in `evals/job-001.lines.json`; `node scripts/eval-verifier.mjs` runs them on each host (Baseten: 19/19 and 5/5 seeded bad lines caught; Fireworks: 18/19 and 5/5, ~17 s, about the same tokens; Modal: 19/19 and 5/5, ~3.5 s for 16 lines, but its shared endpoint returns 429 when about 18 lines are checked at once, so a lone host retries with backoff). Cost: Modal billed $0.06 for ~27k in / 6k out tokens, the same as Fireworks' list price ($1.25 / $4.25 per 1M), so a fresh check of a job is about $0.05. Host order is set by `VERIFIER_HOSTS`. Failover tested Oct 27: with Baseten unreachable, lines are checked on Fireworks.

Each partner has one job. All three sit behind one small verifier client, so changing provider is a config change.

### Baseten: the main verifier

Muse Spark (Meta Model API) drafts the note. **Muse Spark Open on Baseten** checks it, so a different model on different infrastructure verifies every line.

1. Code checks run first: drop numbers that aren't in the sources and unknown citations.
2. For each remaining line, send Muse Spark Open the line plus its cited sources (text, transcripts and photos) and get back `supported / partial / unsupported` with a short reason, as validated JSON.
3. Unsupported lines are dropped. Partial lines become a follow-up question to the technician (the agentic step).
4. The UI marks verified lines; hovering shows the verifier's reasoning.

- Model ID: `meta-models/muse-spark-open-1026` (not the ID in Baseten's docs). Chat Completions API, key in `.env`.
- On a bad response or a 30 s timeout: try the next host (Fireworks, then Modal), then mark the line "unverified" rather than blocking the note. Verify lines in parallel.
- Budget ($100): measure cost per job on day one, cache results by (line, sources) hash, hard stop at about $80 to keep a reserve for judging week.
- For the open-weights bonus: log the model ID and Baseten request ID for every check, show them on a debug panel, and catch a bad line live in the video.

### Modal: backup endpoint and eval runner

- **Backup:** Muse Spark Open on a Modal Shared Endpoint (per-token, no container to keep warm) as the third host, after Fireworks.
- **Evals:** `modal run evals.py` fans the eval suite out in parallel (citation precision, ungrounded numbers, Why coverage, verifier precision and recall on about 10 seeded bad lines). Run it on every major change from Oct 29.
- Not for hosting the web app (that goes on Vercel).
- Budget ($100): eval runs and failover; keep about $40 for judging week.
- Setup: `modal setup`, `modal endpoint create --shared --model <Muse Spark Open id from the Model Library>`, `modal workspace proxy-tokens create`; put the token and the endpoint's model id in `.env` (the API base is `https://inference.us-west.modal.direct/v1`, not the dashboard URL), then `node --env-file=.env scripts/spark-open-hello.mjs modal`.

### Fireworks: small-model verifier (cut unless far ahead)

Solo build: only if P0 and P1 are done early. The dates below are where it would fit.

1. **Data (Oct 31):** Muse Spark Open labels a few hundred synthetic drafted lines with verdicts and reasons.
2. **Train (Nov 1):** fine-tune Muse Glimmer on Fireworks with those labels; hold back 20% for testing.
3. **Measure (Nov 2):** agreement with Spark Open and catch rate on the seeded bad lines, against latency and cost per job. Report the table here.
4. **Use:** if it's good enough, Glimmer checks first and escalates uncertain lines to Spark Open. If not, report it as an experiment.

- Muse Spark Open is also on Fireworks serverless (`accounts/fireworks/models/muse-spark-open`, $1.25 / $4.25 per 1M tokens in / out); it is the verifier's first fallback.
- Budget ($100): check what a fine-tune costs before starting.
- The Oct 30 session ("From Inference to Training with Muse Open Models") is the background; bring the label format to ask about.

| Day | Baseten | Modal | Fireworks |
|---|---|---|---|
| Oct 27 | Hello call with image and audio; measure latency and cost | Hello call on Endpoints; check cold starts | |
| Oct 29 | Verifier step in the pipeline | Eval runner | |
| Oct 30 | | | Attend session |
| Oct 31 | (Glimmer labels, only if ahead) | | |
| Nov 1 | Verified marks in the UI; verifier also runs on the homeowner proposal | | (Glimmer fine-tune, only if ahead) |
| Nov 2 | Verifier evals and spend cap | Failover from Baseten; final eval numbers | |
| Nov 3–9 | Debug panel and README section; live for judging | Warm container for demo and judging | |

## Plan

| Day | Work |
|---|---|
| Mon Oct 26 | Join Discord and post in #intros. ~~Request Baseten, Modal and Fireworks credits~~ (done; waiting for credits). ~~Watch kickoff~~. Read the Official Rules. ~~Claim Meta API credits~~ (done, $150); add a card and set a spend limit. Make the repo public. "Hello" call to Muse Spark with an image. |
| Tue Oct 27 | Data model (Job, Source, Claim, Citation). Synthetic fixtures: 5 jobs with threads (text, voice notes, photos of public-domain or self-shot equipment) and job facts; 2 of them end in a replacement recommendation. Glasses spike (2 hours, timeboxed). Agents 101 at noon. Book time at the shop with the owner, technicians and comfort advisor. |
| Wed Oct 28 | Close-out agent: source ids → Muse Spark drafts cited lines → code checks → render with `[n]` markers. Agents 102 (verifiable agents) at noon; bring questions. **Video storyboard**: shot list, the job we follow, what each beat needs from the product. |
| Thu Oct 29 | ~~Baseten verifier~~ (with Fireworks and Modal failover). ~~Voice notes with Muse Voice Transcribe~~. Close-out agent loop from Agents 102: checklist, questions to the technician, office sign-off. |
| Fri Oct 30 | Finish the agent loop and its trace view. Mobile capture page (technician answers on the phone), metadata stripping, Vercel Blob storage, shop passcode. Fireworks session at noon. |
| (Sat Oct 31, first thing) | **Deploy P0 to a live URL** (moved from Oct 30 for the agent loop) and keep it deployed. |
| Sat Oct 31 | **Tech testing round 1** starts. Glasses capture into the job thread. **Rough cut** of the video from screen recordings; list the gaps. |
| Sun Nov 1 | Fix what round 1 found. Advisor and homeowner proposal page with evidence cards; verifier runs on it too. |
| Mon Nov 2 | Morning: shadow test at the shop and film the glasses POV footage. Afternoon: evals (citation precision, ungrounded numbers, Why coverage, verifier recall), Modal failover, hardening. **Feature freeze at 8 PM.** |
| Tue Nov 3 | Full day on the video: final cut, voiceover, captions, then the 30–45 second X cut. "Built during the hackathon" section in this README. Draft the submission page. Last day for organizer troubleshooting. |
| Wed Nov 4 | Morning: watch the video fresh, fix anything that drags, check the repo in a logged-out browser. **Submit by noon ET** (hard deadline 9 PM ET). Post on X and share the gallery link. |
| Nov 5 – 9 | Keep the X post going through Nov 8. Closing ceremony Mon Nov 9 at 12 PM ET. |

At the shop, by Nov 3: conversations with the owner, at least two technicians and the comfort advisor; a written pilot commitment; the shadow test; quotes and footage we have permission to use.

## Open questions

- Meta Model API: endpoint shape, auth, image input format, structured output support, and rate limits on the $150 credit.
- SAM 3.1 is on the Model API; confirm the input and output format (mask encoding) and latency.
- Official Rules: confirm the deadline and the video length against the guide once published.
- Wearables Device Access Toolkit: which camera and audio capture our glasses model supports, and whether we build the companion app for iOS or Android.
