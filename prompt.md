# The canonical prompt

```
Create Conway game of life as a web page
```

That's it. No requirements list. No scoring rubric. No mention of Canvas vs DOM, toroidal wrap, patterns, controls, or any other specific feature.

This is deliberate. The historical 59 outputs in `outputs/` were all generated with this exact prompt. Some models interpreted it minimally (a 30×30 DOM grid with a Start button). Some went wild — Gemini built a full 3D Three.js simulation with audio synthesis. Others produced broken code, undefined variables, or (in one case) a Croatian landscape SVG.

The lack of specification is the test: **what does a model pick when you ask for "a web page" without saying how good it needs to be?**

If you want to re-run the bench with stricter requirements (e.g. "must use Canvas 2D, must have 3 named patterns, must be responsive"), edit this file before running `node scripts/bench.js`.