---
# Product page: /products/fingerprints/ (see ecconus.md for how these files work)
title: Microphysical fingerprints
order: 4
stage: exploratory
icon: fingerprints
summary: >-
  Which processes are shaping the rain, read from how reflectivity (Z) and differential
  reflectivity (Z_DR) change with height below the melting layer.
facts:
  - label: Input
    value: MRMS 3D mosaics of Z, Z_DR and ρ_hv on 33 heights
  - label: Method
    value: Fingerprints after Kumjian et al. (2022)
  - label: Updates
    value: About every 5 minutes, the Z_DR and ρ_hv cadence
credits: [mrms, fingerprints]
---

## What it is

Rain carries fingerprints of the processes that shaped it. On the way down from the melting layer, collision–coalescence, breakup, evaporation and size sorting each change the drop size distribution in their own way, and a dual-polarization radar sees those changes as trends in Z and Z<sub>DR</sub> with height. For example, when Z and Z<sub>DR</sub> both increase toward the ground, drops are growing by collision–coalescence. Kumjian et al. (2022) review these fingerprints for rain and for ice.

This product looks for those fingerprints across the U.S., column by column, in MRMS's 3D mosaics.

## How it works

- MRMS has 3D mosaics of Z every 2 minutes, and of Z<sub>DR</sub> and ρ<sub>hv</sub> about every 5 minutes, on 33 heights.
- Find the melting layer from ρ<sub>hv</sub> and the model freezing level, then measure how Z and Z<sub>DR</sub> change with height below it.
- Classify each column by those changes, with masks where confidence is low.
- Later, summarize each storm object by the share of its columns in each process.

MRMS has no mosaic of specific differential phase (K<sub>DP</sub>), which would help a lot with ice, so this starts with Z and Z<sub>DR</sub> in rain.

## Where it stands

Exploratory. A mosaic blends many radars, and Z<sub>DR</sub> offsets between neighboring radars, beam height and the melting layer itself can all mimic or hide a fingerprint. So this starts as research: check the mosaics against single-radar profiles, prototype the classifier on case days, and validate it. It goes live only if it holds up.
