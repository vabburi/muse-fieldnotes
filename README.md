# muse-fieldnotes

Field notes that keep the *why*. These are job close-outs for home-service technicians, built on Meta's models for the Meta Global AI Developer Hackathon. The build window is Oct 26 – Nov 4, 2026, and this is a startup track entry under the "Build for Your World" theme.

A technician's photos, voice notes and messages from a job become a close-out note: Found / Done / Parts / Quoted / Why / Follow-up / Notes. Each line cites the evidence it rests on. Clicking a citation highlights what the technician pointed at in the photo.

## Ground rules for this repo

- **Synthetic data only.** No real customers, technicians, job numbers or addresses. Every fixture is invented.
- **Nothing from private repos.** Under the event waiver, shared materials are non-confidential, and the organizers get a perpetual license to submissions. Everything here is new work written for this project.
- **No secrets in git.** API keys go in `.env`, which is git-ignored.
- **Implementation starts at kickoff (Oct 26).** Until then, this README is the plan.

## Plan

Judging weights: Impact 30% · Use of Meta AI tooling 25% · Technical depth 20% · Demo 25%.

| Day | Work |
|---|---|
| Oct 26 | Kickoff. Read the Official Rules and Meta Model API docs. Get an API key, then make a "hello" call to Muse Spark with an image. |
| Oct 27 | Synthetic job fixtures: 5 jobs, each with a thread (text, voice transcripts, photos of public-domain or self-shot equipment) and job facts. |
| Oct 28–29 | Close-out pipeline: give each message a source id → Muse Spark drafts cited lines → deterministic grounding (drop lines whose numbers aren't in the text, drop unknown citations) → render with `[n]` markers and a Sources line. |
| Oct 30–31 | Evidence view: SAM 3.1 segments the equipment in each cited photo. The UI shows the note, and clicking `[n]` shows the source with the mask overlaid. |
| Nov 1 | "Why" capture: when a job has a recommendation, ask for a voice note; the transcript feeds the Why line. Pick the speech-to-text option (a Meta open-weights model if one fits, else a fallback). |
| Nov 2 | Eval: a small check over the fixtures (citation precision, no ungrounded numbers, Why present when stated). Report the numbers in the README. |
| Nov 3 | Demo polish and the 2-minute video. |
| Nov 4 | Submit by 9:00 PM ET. |

Stretch: capture from Ray-Ban Meta glasses through the Meta Wearables Device Access Toolkit (a hands-free photo and voice note into the job thread).

## Open questions (resolve at kickoff)

- Meta Model API: endpoint shape, auth, image input format, JSON or structured output support, and rate limits on the $150 credit.
- Is SAM 3.1 served through the Model API, or run as open weights (Baseten/Modal credits)?
- Official Rules: does pre-existing code count, and does the repo need to be public for judging?
