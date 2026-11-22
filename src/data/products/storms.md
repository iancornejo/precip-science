---
# Product page: /products/storms/ (see ecconus.md for how these files work)
title: Storm objects
order: 2
stage: planned
icon: storms
summary: >-
  Individual storms found and tracked with TITAN, each with its path and history, using ECCO
  convectivity to keep stratiform rain from counting as a storm.
facts:
  - label: Input
    value: MRMS composite reflectivity and EcConus convectivity
  - label: Method
    value: TITAN, from LROSE
  - label: Output
    value: Storm outlines and tracks at every update, and a history for each storm
credits: [mrms, titan, lrose, ecco, eccopy]
---

## What it is

TITAN (Thunderstorm Identification, Tracking, Analysis and Nowcasting) finds storms as connected areas of strong reflectivity, matches them from one radar update to the next, and follows them as they move, merge and split. Each storm keeps a history of its size, peak reflectivity, echo top and motion.

## How it works

Storm objects start on the 2D MRMS composite. To count as a storm, an area has to pass two tests: strong enough reflectivity and high enough ECCO convectivity. The second test matters, because on reflectivity alone the bright band in stratiform rain can turn into spurious storms. Both thresholds get tuned on archived case days before anything goes live.

TITAN also extrapolates each storm’s motion, which can give outlines 30 or 60 minutes ahead. If those are shown, they'll be labeled as experimental extrapolations, not forecasts.

## Where it stands

Planned, after EcConus. The goal is a map where you can click a storm and see its path, its history and how much of it is convective. TITAN moves to the 3D mosaic later, alongside EcConus 3D.
