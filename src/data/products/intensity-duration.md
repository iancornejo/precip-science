---
# Product page: /products/intensity-duration/ (see ecconus.md for how these files work)
title: Rainfall intensity and duration
order: 2
stage: planned
icon: intensity-duration
summary: >-
  How hard and how long it has rained over the last 48 hours across the contiguous United
  States: each spot's heaviest rain period, mapped by its duration and average rain rate.
facts:
  - label: Input
    value: MRMS rain rate, summed into hourly totals
  - label: Method
    value: Rain periods after Cornejo et al. (2024)
  - label: Window
    value: The last 48 hours, refreshed with each new rain-rate frame
credits: [mrms, intensity-duration]
---

## What it is

Heavy rain comes from rain that is intense, long-lasting or both. This product maps the two together. At every grid point it finds the rain periods of the last 48 hours, takes the one with the most rain, and colors it by how long it lasted and how hard it rained on average, so short convective downpours and long, steady rain stand apart at a glance.

## How it works

- MRMS rain rates, published every 2 minutes, are summed into hourly totals.
- A rain period is a run of hours with at least 0.25 mm each, allowing a single dry hour inside it.
- A period's total divided by its length gives its average rain rate. The period with the most rain goes on a 4 × 4 color grid of duration against average rate.

The method comes from a study of extreme mei-yu rainfall over Taiwan (Cornejo et al. 2024). The class limits will be set for the United States first, with a snow version to follow.

## Where it stands

Planned next. Outlines will mark rain that's still going, and pinning a point on the map will list every rain period there, with the mapped one highlighted.
