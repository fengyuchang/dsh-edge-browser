# Third-party notices

This is a community customization, not an official DeepSeek or Microsoft extension.
Original upstream copyright notices remain in the distributed code.

| Component | Source | Version / revision | License |
| --- | --- | --- | --- |
| BrowserSkill extension and native Harness plugin | [Tencent/BrowserSkill](https://github.com/Tencent/BrowserSkill) | 0.3.3; extension release `ext-v0.3.3` | [MIT](licenses/BrowserSkill-MIT.txt), copyright Tencent |
| Selected-conversation publication and annotation design adaptation | [SheepofSheep/dsh-doyourweb](https://github.com/SheepofSheep/dsh-doyourweb) | `0cbc4bf444d262caf6c47e046b90cab3d24e280f` | [MIT](licenses/dsh-doyourweb-MIT.txt) |
| Node.js, in the Windows offline release only | [nodejs/node](https://github.com/nodejs/node) | The build's Node.js runtime | [Node.js and bundled dependencies](licenses/Node.js.txt) |
| Harness runtime peers and transitive dependencies, in the offline release only | Individual npm packages | Pinned in `package-lock.json`; recorded in the release's `dependency-inventory.json` | Original licenses remain in each package |

`extension/` contains the complete customized extension distribution, including
upstream bundled code. Readable custom logic lives in its `dsh-*.js` files and
`content-scripts/dsh-controls.js` / `dsh-pointer.js`. The upstream TypeScript and
build tooling are available in Tencent's repository. `packages/` contains the
complete patched native plugin distribution; `harness/` contains the readable
custom helpers and browser skill. Both copies are checked for consistency.

Local changes include task tab grouping and muting, command-driven visual
feedback, annotations, selected-chat delivery, per-chat browser isolation,
collapsible controls, shortcuts, packaging and documentation. See
[`provenance.json`](provenance.json) for the upstream archive URL and checksum.

The offline release does not include Edge or DeepSeek Harness Desktop itself.
# Website demonstration screenshots

`docs/assets/nasa-*.png` and `nasa-comet-demo.gif` show actual interactions or
clearly labeled pointer-component replay on [NASA Science's Webb mission page](https://science.nasa.gov/mission/webb/).
Website content, logos and credited imagery remain attributed to NASA and the
respective rights holders. These screenshots illustrate browser interaction;
the repository's MIT license does not relicense third-party website material.
