---
# Product page: /products/ecconus/
# To edit: open this file on GitHub, click the pencil, change it, commit. The site redeploys
# in a few minutes. The fields between the --- lines feed the page header, the product cards
# and the facts box; the text below them is the page itself (Markdown).
#   stage:   live | in-development | planned | exploratory | feasibility-study
#   summary: plain text; write Z_DR for Z with a subscript DR
#   credits: ids from src/data/credits.yaml
#   map:     the product's live map on this site (adds an "Open the live map" button)
title: EcConus
order: 1
stage: live
map: /map/
icon: ecconus
summary: >-
  ECCO echo types and convectivity across the contiguous United States, from NOAA's MRMS
  radar mosaic, updated every couple of minutes.
facts:
  - label: Input
    value: MRMS composite reflectivity (2D); the 3D mosaic later
  - label: Method
    value: ECCO, run with EccoPy
  - label: Coverage
    value: Contiguous U.S. on MRMS's native 0.01° grid (about 1 km)
  - label: Updates
    value: Every 2 minutes, with each new MRMS composite
figures:
  - src: ../../assets/figures/ecconus-convectivity.png
    alt: >-
      Map of convectivity over Nebraska, Iowa and nearby states. A long arc of high convectivity
      marks the derecho's leading line, inside a broad shield of low convectivity.
    caption: Convectivity, from 0 (stratiform) to 1 (convective). The color breaks at 0.4 and 0.5 are the class thresholds.
  - src: ../../assets/figures/ecconus-echo-type.png
    alt: >-
      Map of echo type over the same area. Convective echo forms a narrow line along the leading
      edge, edged by mixed echo, with widespread stratiform echo behind and around it.
    caption: Echo type, from thresholding convectivity.
figure_credit: >-
  Sample frame: EccoPy 2D on the MRMS composite, 15 Dec 2021, 22:38 UTC, during the serial
  derecho. Colors are EccoPy's defaults.
credits: [mrms, ecco, eccopy]
links:
  - label: EccoPy on GitHub
    url: https://github.com/iancornejo/EccoPy
---

## What it is

ECCO (Echo Classification from COnvectivity) sorts radar echo by how textured the reflectivity field is. Convective cells are intense and patchy, while stratiform rain is weaker and smoother. ECCO turns that texture into convectivity, a number between 0 (stratiform) and 1 (convective), and thresholds on convectivity give each pixel an echo type: stratiform, mixed or convective.

EcConus runs ECCO over the contiguous United States (CONUS) in near real time, so you can watch how the convective and stratiform parts of a storm system are organized as it evolves.

## How it works

- Every 2 minutes, NOAA's Multi-Radar/Multi-Sensor System (MRMS) publishes a new composite reflectivity mosaic.
- EccoPy's 2D mode measures reflectivity texture within 7 km of each pixel, turns it into convectivity, and classifies the echo.
- Every frame carries a product version (v0.x), with the EccoPy version and parameters written into it.

## Where it stands

EcConus 2D is live: the [map](/map/) shows echo type and convectivity for the last 48 hours, next to the raw MRMS composite, rain rate and precipitation type. It updates every 2 minutes, a few minutes behind real time. A 3D version, with echo types at every height (stratiform low, mid and high; convective elevated, shallow, mid and deep), comes later, once EccoPy 3D can handle the full MRMS volume within this project's computing budget.
