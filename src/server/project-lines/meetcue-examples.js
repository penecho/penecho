"use strict";
// Built-in MeetCue example meetings so anyone can explore meeting detail pages, whole + per-topic diagrams,
// and linking a meeting in the composer/project lines before connecting a MeetCue account.

const EXAMPLES = [
  {
    meeting:{
      id:"example-launch-sync",
      title:"Product launch & Q4 pricing sync",
      status:"ended",
      started_at:"2026-11-18T10:00:00.000Z",
      ended_at:"2026-11-18T10:38:00.000Z",
      duration_ms:2280000,
      minutes_ready:true,
      action_count:3,
      gist:"Aligned on Q4 Pro and Team pricing tiers, locked November 28 for the public beta launch, and assigned regional partner rollout owners.",
      example:true,
    },
    actions:[
      { task:"Publish updated Pro and Team pricing table on penecho.ai", owner:"Maya", due:"Friday" },
      { task:"Finalize beta onboarding checklist and sample workspace", owner:"Liam", due:"Tuesday" },
      { task:"Send partner rollout brief to APAC channel leads", owner:"Kenji", due:"Next Wednesday" },
    ],
    map:{
      title:"Product launch & Q4 pricing sync",
      gist:"Aligned on Q4 Pro and Team pricing tiers, locked November 28 for the public beta launch, and assigned regional partner rollout owners.",
      topics:[
        {
          id:"t_pricing",
          label:"Pricing & packaging",
          status:"done",
          sofar:["Pro at $12/mo and Team at $29/seat approved", "Shared credit pool works across Lines and MeetCue"],
          ahead:["Should annual billing offer 20% off at launch?"],
        },
        {
          id:"t_launch",
          label:"Launch timeline",
          status:"active",
          sofar:["Public beta locked for Nov 28", "Zero-config starter templates ready for QA"],
          ahead:["Confirm localization schedule for JP docs"],
        },
        {
          id:"t_channel",
          label:"Channel rollout",
          status:"upcoming",
          sofar:["APAC pilot starts with 5 channel partners"],
          ahead:["Need co-marketing deck by Dec 2"],
        },
      ],
      nodes:[
        { id:"p1", label:"Maya", kind:"person", note:"Product lead", topic:"t_pricing" },
        { id:"m1", label:"Pro Tier", kind:"metric", note:"$12/mo · 4,000 credits", topic:"t_pricing" },
        { id:"m2", label:"Team Tier", kind:"metric", note:"$29/seat · shared pool", topic:"t_pricing" },
        { id:"p2", label:"Liam", kind:"person", note:"Engineering lead", topic:"t_launch" },
        { id:"s1", label:"Public Beta", kind:"project", note:"Nov 28 release", topic:"t_launch" },
        { id:"d1", label:"Starter Templates", kind:"doc", note:"Preloaded sample lines", topic:"t_launch" },
        { id:"p3", label:"Kenji", kind:"person", note:"Partnerships", topic:"t_channel" },
        { id:"o1", label:"APAC Partners", kind:"org", note:"5 launch agencies", topic:"t_channel" },
      ],
      edges:[
        { id:"p1__m1", from:"p1", to:"m1", label:"proposes", kind:"owns" },
        { id:"p1__m2", from:"p1", to:"m2", label:"scopes", kind:"owns" },
        { id:"m1__s1", from:"m1", to:"s1", label:"ships in", kind:"flow" },
        { id:"p2__s1", from:"p2", to:"s1", label:"owns", kind:"owns" },
        { id:"d1__s1", from:"d1", to:"s1", label:"included in", kind:"support" },
        { id:"s1__o1", from:"s1", to:"o1", label:"rolled out to", kind:"flow" },
        { id:"p3__o1", from:"p3", to:"o1", label:"leads", kind:"owns" },
      ],
      tree:{
        thread:"Lock Q4 Pro & Team pricing, ship Nov 28 public beta with starter templates, and roll out across 5 APAC partners.",
        hubs:[],
        frames:[
          { id:"t_pricing" },
          { id:"t_launch", parent:"t_pricing", rel:"unlocks" },
          { id:"t_channel", parent:"t_launch", rel:"rolls out to" },
        ],
      },
    },
    diagrams:[
      {
        topic:"Pricing & packaging",
        status:"done",
        sofar:["Pro at $12/mo and Team at $29/seat approved", "Shared credit pool works across Lines and MeetCue"],
        ahead:["Should annual billing offer 20% off at launch?"],
        nodes:[
          { id:"p1", label:"Maya", kind:"person", note:"Product lead" },
          { id:"m1", label:"Pro Tier", kind:"metric", note:"$12/mo · 4,000 credits" },
          { id:"m2", label:"Team Tier", kind:"metric", note:"$29/seat · shared pool" },
        ],
        edges:[
          { from:"p1", to:"m1", label:"proposes", kind:"owns" },
          { from:"p1", to:"m2", label:"scopes", kind:"owns" },
        ],
      },
      {
        topic:"Launch timeline",
        status:"active",
        sofar:["Public beta locked for Nov 28", "Zero-config starter templates ready for QA"],
        ahead:["Confirm localization schedule for JP docs"],
        nodes:[
          { id:"p2", label:"Liam", kind:"person", note:"Engineering lead" },
          { id:"s1", label:"Public Beta", kind:"project", note:"Nov 28 release" },
          { id:"d1", label:"Starter Templates", kind:"doc", note:"Preloaded sample lines" },
        ],
        edges:[
          { from:"p2", to:"s1", label:"owns", kind:"owns" },
          { from:"d1", to:"s1", label:"included in", kind:"support" },
        ],
      },
      {
        topic:"Channel rollout",
        status:"upcoming",
        sofar:["APAC pilot starts with 5 channel partners"],
        ahead:["Need co-marketing deck by Dec 2"],
        nodes:[
          { id:"p3", label:"Kenji", kind:"person", note:"Partnerships" },
          { id:"o1", label:"APAC Partners", kind:"org", note:"5 launch agencies" },
          { id:"s1", label:"Public Beta", kind:"project", note:"Nov 28 release" },
        ],
        edges:[
          { from:"p3", to:"o1", label:"leads", kind:"owns" },
          { from:"s1", to:"o1", label:"rolled out to", kind:"flow" },
        ],
      },
    ],
    markdown:`# Product launch & Q4 pricing sync

Aligned on Q4 Pro and Team pricing tiers, locked November 28 for the public beta launch, and assigned regional partner rollout owners.

## Decisions

- **Pro tier** launches at **$12/month** with 4,000 shared credits across PenEcho Lines, Canvas, and MeetCue.
- **Team tier** launches at **$29/seat** with a shared credit pool and cross-project meeting links.
- **Public beta date** is locked for **November 28**, bundled with starter templates so new users can explore immediately.
- **APAC partner pilot** begins with 5 channel agencies right after beta sign-off.

## Key Discussion

### Pricing & packaging
Maya walked through usage benchmarks from early testers. Keeping one shared credit wallet across PenEcho and MeetCue removes friction and avoids separate billing plans. Annual discount timing remains open until post-beta conversion data arrives.

### Launch timeline
Liam confirmed the build pipeline and preloaded sample workspaces are ready for final QA. Documentation localization for Japanese and Chinese follows one week after launch.

### Channel rollout
Kenji will share the rollout brief and partner demo guide with the 5 APAC agencies next Wednesday.

## Open Questions

- Should annual billing launch with a 20% discount on day one or wait for January?
- Confirm final timeline for Japanese documentation and tutorial clips.
`,
  },
  {
    meeting:{
      id:"example-customer-discovery",
      title:"Customer discovery: onboarding friction",
      status:"ended",
      started_at:"2026-11-14T15:30:00.000Z",
      ended_at:"2026-11-14T15:54:00.000Z",
      duration_ms:1440000,
      minutes_ready:true,
      action_count:2,
      gist:"Reviewed interviews with 4 design-team leads; agreed to ship interactive example meetings and one-click diagram export to Canvas to shorten time-to-value.",
      example:true,
    },
    actions:[
      { task:"Add interactive example meetings to the MeetCue tab and input box", owner:"Elena", due:"Thursday" },
      { task:"Test one-click Canvas diagram editing with two pilot teams", owner:"Sam", due:"Next Monday" },
    ],
    map:{
      title:"Customer discovery: onboarding friction",
      gist:"Reviewed interviews with 4 design-team leads; agreed to ship interactive example meetings and one-click diagram export to Canvas to shorten time-to-value.",
      topics:[
        {
          id:"t_setup",
          label:"First-run setup",
          status:"done",
          sofar:["Users want live examples before linking accounts"],
          ahead:["Track conversion from example view to Connect MeetCue"],
        },
        {
          id:"t_canvas",
          label:"Canvas workflow",
          status:"done",
          sofar:["One-click Canvas editing solves diagram handoff"],
          ahead:[],
        },
      ],
      nodes:[
        { id:"c1", label:"Design Leads (4)", kind:"org", note:"Interviewed cohort", topic:"t_setup" },
        { id:"f1", label:"Empty State Drop-off", kind:"concept", note:"Users hesitate before connecting", topic:"t_setup" },
        { id:"s2", label:"Example Meetings", kind:"system", note:"Try diagrams & minutes instantly", topic:"t_setup" },
        { id:"s3", label:"PenEcho Canvas", kind:"system", note:"Editable visual workspace", topic:"t_canvas" },
        { id:"m3", label:"Time-to-Value", kind:"metric", note:"Target < 2 min", topic:"t_canvas" },
      ],
      edges:[
        { id:"c1__f1", from:"c1", to:"f1", label:"reported", kind:"rel" },
        { id:"s2__f1", from:"s2", to:"f1", label:"eliminates", kind:"conflict" },
        { id:"s2__s3", from:"s2", to:"s3", label:"exports to", kind:"flow" },
        { id:"s3__m3", from:"s3", to:"m3", label:"improves", kind:"support" },
      ],
      tree:{
        thread:"Ship interactive example meetings to eliminate empty-state drop-off and connect diagrams directly to PenEcho Canvas.",
        hubs:[],
        frames:[
          { id:"t_setup" },
          { id:"t_canvas", parent:"t_setup", rel:"hands off to" },
        ],
      },
    },
    diagrams:[
      {
        topic:"First-run setup",
        status:"done",
        sofar:["Users want live examples before linking accounts"],
        ahead:["Track conversion from example view to Connect MeetCue"],
        nodes:[
          { id:"c1", label:"Design Leads (4)", kind:"org", note:"Interviewed cohort" },
          { id:"f1", label:"Empty State Drop-off", kind:"concept", note:"Users hesitate before connecting" },
          { id:"s2", label:"Example Meetings", kind:"system", note:"Try diagrams & minutes instantly" },
        ],
        edges:[
          { from:"c1", to:"f1", label:"reported", kind:"rel" },
          { from:"s2", to:"f1", label:"eliminates", kind:"conflict" },
        ],
      },
      {
        topic:"Canvas workflow",
        status:"done",
        sofar:["One-click Canvas editing solves diagram handoff"],
        ahead:[],
        nodes:[
          { id:"s2", label:"Example Meetings", kind:"system", note:"Try diagrams & minutes instantly" },
          { id:"s3", label:"PenEcho Canvas", kind:"system", note:"Editable visual workspace" },
          { id:"m3", label:"Time-to-Value", kind:"metric", note:"Target < 2 min" },
        ],
        edges:[
          { from:"s2", to:"s3", label:"exports to", kind:"flow" },
          { from:"s3", to:"m3", label:"improves", kind:"support" },
        ],
      },
    ],
    markdown:`# Customer discovery: onboarding friction

Reviewed interviews with 4 design-team leads; agreed to ship interactive example meetings and one-click diagram export to Canvas to shorten time-to-value.

## Findings

- **Cold-start hesitation:** New users want to see real meeting maps, diagrams, and action items before installing the mobile app and linking accounts.
- **Visual handoff:** Teams loved turning meeting topic maps directly into editable PenEcho Canvases without redrawing diagrams by hand.

## Decisions

- Ship built-in **example meetings** accessible directly in the MeetCue tab and inside the composer input box.
- Keep **Full meeting map** alongside **per-topic diagrams** so both high-level overview and focused topic review work in one place.
`,
  },
];

const BY_ID = new Map(EXAMPLES.map(entry => [entry.meeting.id, entry]));

function isExampleId(id) {
  return BY_ID.has(String(id || ""));
}

function listExamples() {
  return EXAMPLES.map(entry => ({ ...entry.meeting }));
}

function getExample(id) {
  const found = BY_ID.get(String(id || ""));
  return found ? structuredClone(found) : null;
}

module.exports = { EXAMPLES, isExampleId, listExamples, getExample };
