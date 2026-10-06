"use strict";
// One illustration policy for the sketch-illustration suggestion (action id "vivid"), shared by
// Canvas AI, the PenEcho Agent route and Widget Refine. Prompts are maintained in English and were
// chosen by rendered comparisons (docs/verification/storybook-illustration-20261004).
var PenEchoIllustrationStyle = (() => {
  const STYLES = Object.freeze(["storybook", "3d"]), DEFAULT = "storybook";
  const BACKGROUNDS = Object.freeze(["auto", "none"]), DEFAULT_BACKGROUND = "auto";
  const LABELS = Object.freeze({
    storybook:Object.freeze({ en:"Storybook illustration", zh:"绘本插画" }),
    "3d":Object.freeze({ en:"3D illustration", zh:"立体插画" }),
  });
  // Fidelity: render what was drawn, in the drawn detail; both styles share this.
  const keep = "Render the subjects as drawn: every drawn subject, part and detail (eyes, mouth, antennae, legs, segments, tails, marks) in its drawn number, place, size, pose, facing and expression; refine wobbly lines into confident shapes. Simplified marks may become simple bodies and limbs, but add no parts, hair, ears, clothing, accessories or held props that were not drawn. Drawn colours other than default dark ink set each part's colour family; skin may stay natural.";
  const reasoning = "Plan briefly and never draft coordinates in your reasoning.";
  const drawnSetting = "Setting: keep any drawn ground, sky, sun, plants, water or buildings in place, restyled.";
  const LOOKS = Object.freeze({
    storybook:Object.freeze({
      look:"Turn the newest freehand drawing into a cute, polished children's picture-book illustration.",
      character:"Shapes: smooth organic Bezier silhouettes, never sticks, tubes or plain stacked circles; parts overlap and connect convincingly; limbs are rounded and tapered. Finish drawn faces with a white eye glint and soft pink cheeks, and each main part with one subtle shade. Several subjects share one scene.",
      style:"Style: a soft harmonious pastel palette, mostly flat matte fills, thin even warm dark brown-grey outlines (#4a4039, round joins) on every shape.",
      auto:"If none were drawn, add a simple setting that suits the subjects (a leafy garden for a caterpillar, a park for a walker, underwater for a fish): a pale flat sky, lighter distant hills or trees, an outlined ground shape (never a bare line through the subjects) and 6-10 varied small scene details, some in front. Subjects fill 55-65% of the scene height, with soft contact shadows.",
      none:"Add no scenery of your own: with nothing drawn around them, place the subjects on a plain warm cream card. Subjects fill 65-75% of the card height, with soft contact shadows.",
      avoid:"Avoid glossy or 3D shading, realism, thick black outlines and text.",
    }),
    "3d":Object.freeze({
      look:"Turn the newest freehand drawing into a polished soft 3D illustration, like a glossy vinyl toy or clay figure.",
      character:"Shapes: chunky rounded volumes built from smooth Bezier silhouettes, never sticks, tubes or flat stacked circles; parts overlap and connect convincingly. Finish drawn eyes with bright glossy highlights. Several subjects share one scene.",
      style:"Style: one upper-left key light; radial and linear gradients that model every form (gradients fill closed shapes, never strokes), crisp specular highlights, soft core shadows and ambient occlusion where parts meet; saturated harmonious colours; no outlines, only slightly darker edges.",
      auto:"If none were drawn, add a soft studio scene that suits the subjects: a smooth gradient backdrop, a softly lit ground plane and 3-5 simple rounded 3D scene props (hills, flowers, leaves, pebbles) in lower contrast. Subjects fill 55-65% of the scene height, with soft contact shadows.",
      none:"Add no scenery of your own: with nothing drawn around them, place the subjects on a plain softly lit gradient card. Subjects fill 65-75% of the card height, with soft contact shadows.",
      avoid:"Avoid realism, noisy texture, neon overload, muddy colours and text.",
    }),
  });
  const canvasDelivery = "Return exactly one html_widget (pluginId general): responsive HTML with transparent html and body and one inline SVG filling it, the scene painted as a borderless rounded-corner card, 4:3 (3:4 if very tall), about the sketch's height, in free space beside the sketch. Integer coordinates, <use> for repeats; no scripts, animation or external assets.";
  const agentDelivery = "Deliver one responsive General HTML Widget: transparent html and body, one borderless inline SVG scene card with rounded corners, 4:3 or 3:4, no text, scripts, animation, controls, external assets or network requests, placed in nearby free space without changing or covering the sketch. Inspect the rendered result for fidelity to the drawing, the requested style and setting before reporting completion.";
  const normalize = value => STYLES.includes(value) ? value : DEFAULT;
  const normalizeBackground = value => BACKGROUNDS.includes(value) ? value : DEFAULT_BACKGROUND;
  function policy(style, background) {
    const look = LOOKS[normalize(style)];
    return [look.look, keep, reasoning, look.character, look.style, drawnSetting, look[normalizeBackground(background)], look.avoid].join(" ");
  }
  const canvasPrompt = (style, background) => `${policy(style, background)} ${canvasDelivery}`;
  const agentPrompt = (style, background) => `${policy(style, background)} ${agentDelivery}`;
  // Widget Refine restyles an existing widget, which may not be a drawing at all.
  function widgetInstruction(style, background, { inPlace = true } = {}) {
    const solid = normalize(style) === "3d", scenery = normalizeBackground(background) === "none"
      ? "Add no scenery of your own."
      : solid ? "Add a soft studio backdrop behind it when it has none." : "Add a simple fitting background behind it when it has none.";
    return `${solid
      ? "Restyle the existing widget as a polished soft 3D illustration: glossy rounded volumes modelled with gradients, crisp specular highlights and soft shadows from one key light, saturated harmonious colour."
      : "Restyle the existing widget as a cute children's picture-book illustration: rounded charming shapes, a soft harmonious pastel palette, mostly flat fills and thin even warm dark brown-grey outlines."} For a sketch or illustration, keep every subject, part and detail as drawn and add no new parts or accessories. ${scenery} For a diagram, chart, document or interactive widget, apply only the palette and shading treatment; keep all meaning, text, data, relationships, controls and behavior, and keep scenery away from functional content. ${inPlace ? "Refine this widget in place." : "Create one separate illustrated Widget beside the original. Preserve the original Widget unchanged."}`;
  }
  const label = (style, language) => LABELS[normalize(style)][language === "zh" ? "zh" : "en"];
  return Object.freeze({ STYLES, DEFAULT, BACKGROUNDS, DEFAULT_BACKGROUND, LABELS, normalize, normalizeBackground, policy, canvasPrompt, agentPrompt, widgetInstruction, label });
})();
if (typeof module === "object" && module.exports) module.exports = PenEchoIllustrationStyle;
