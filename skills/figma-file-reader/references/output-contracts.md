# Output contracts

Use these compact structures when reporting Figma parsing work.

## Whole-file overview

```markdown
## Figma file summary

- File: [name]
- Last modified: [timestamp]
- Editor type: [figma / figjam / slides / unknown]
- Scope read: [depth / node ids / local JSON]
- Pages: [count]

## Pages and major frames

1. [Page name] — [N] top-level nodes
   - [Frame/component name] (`[type]`, `[id]`, [width]×[height])

## Notable design-system assets

- Components: [count and examples]
- Component sets: [count and examples]
- Styles: [count and examples]
- Bound variable references: [count if found]

## Limits

- [e.g., fetched to depth 2 only; deeper child layers not inspected]
```

## Node-specific analysis

```markdown
## Node summary

- Node: [name]
- ID: [id]
- Type: [type]
- Size/position: [if available]
- Children: [count by type]

## Relevant contents

- Text: [important strings]
- Components/instances: [component names or IDs]
- Layout: [auto-layout mode, padding, spacing]
- Visuals: [fills, strokes, effects, radius]

## Follow-up fetches needed

- [Only list if the current depth was insufficient]
```

## Design-token report

```markdown
## Design-token candidates

### Colors

| Token candidate                 |               Value | Source nodes |
| ------------------------------- | ------------------: | ------------ |
| [style/name or generated label] | #RRGGBB / rgba(...) | [examples]   |

### Typography

| Candidate | Family | Weight | Size | Line height | Source nodes |
| --------- | ------ | -----: | ---: | ----------: | ------------ |

### Spacing and radius

- Spacing values: [sorted unique values with source examples]
- Radius values: [sorted unique values with source examples]

## Caveats

- These are candidates from node data; confirm named variables/styles when
  required.
```

## Handoff report

```markdown
## Implementation handoff

- Screen/frame: [name]
- Dimensions: [width]×[height]
- Layout model: [Auto layout / absolute / mixed]
- Main regions: [header, content, footer, etc.]
- Components to implement/reuse: [list]
- Copy: [important text]
- Assets/images: [nodes that need image export]
- Interaction/prototype notes: [if inspected]
- Open questions: [missing states, variants, ambiguous tokens]
```
