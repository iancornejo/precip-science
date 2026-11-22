---
# Product page: /products/eccoworld/ (see ecconus.md for how these files work)
title: EccoWorld
order: 4
stage: feasibility-study
icon: eccoworld
summary: >-
  ECCO beyond the United States, on other openly licensed radar composites, plus a research
  comparison with the GPM satellite radar.
facts:
  - label: Input
    value: Open national radar composites, still to be chosen; GPM DPR for comparison
  - label: Method
    value: ECCO, run with EccoPy
credits: [ecco, eccopy]
---

## What it is

ECCO works on any gridded radar reflectivity, and its authors have applied it to radar grids from the U.S., the United Arab Emirates, Australia and Europe. EccoWorld asks whether precip.science can do the same in real time, wherever an open radar composite exists.

## How it works

Two parts, both still open questions:

- **Other national composites.** Find radar composites that are openly licensed and updated in real time, and test EccoPy's 2D mode on one.
- **The GPM satellite radar.** The Dual-frequency Precipitation Radar (DPR) on the Global Precipitation Measurement (GPM) satellite, from NASA and JAXA, covers much of the globe. Its footprint is about 5 km and its swath about 245 km wide, though, too coarse for ECCO's texture to mean what it means on ground radars. So DPR becomes a research comparison: its own convective–stratiform flag against ECCO on matched ground radars.

## Where it stands

A feasibility study. It ends with a decision on what to build, if anything.
