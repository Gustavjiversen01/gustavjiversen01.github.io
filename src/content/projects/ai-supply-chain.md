---
title: "The AI Supply Chain, from Rocks to Tokens"
description: "An interactive map of the AI buildout: 340+ companies and markets across 17 layers, from minerals and EUV optics to chips, power, data centres, frontier labs and the businesses buying tokens. Bottlenecks, money flows and country exposure, with every number sourced and dated."
demo: "https://gustavjiversen01.github.io/ai-supply-chain/"
tags: ["Data visualisation", "AI infrastructure", "Supply chains", "D3", "Python"]
featured: true
publishDate: 2026-10-07
---

**[Open the explorer →](/ai-supply-chain/)**

AI is often described as software, but every token a model produces sits on top of a long physical chain: helium and high-purity quartz, EUV mirrors and lasers, wafer fabs, high-bandwidth memory, advanced packaging, accelerators, optics, transformers and switchgear, power plants, data centres, cloud providers, frontier labs, and finally the businesses that buy the tokens. This explorer maps that chain end to end.

## What you can do with it

- **Overview**: the whole stack on one page, layer by layer, with how tight each layer is and who dominates it.
- **Map**: every company and market, placed in its layer, with its suppliers, customers and financiers. Click anything for its numbers and sources.
- **Bottlenecks**: a 0 to 5 score per layer built from capacity in use, lead times, backlogs, concentration, substitutes and how far away relief is.
- **Flows**: where the money and the megawatts go, from capital providers through compute providers and labs to the token buyers.
- **Demand 2×2**: who buys frontier tokens, sorted by whether the work is bounded and how long one unit of work runs.
- **Countries** and **Cost of capital**: which countries the chain depends on, and how rates and credit spreads feed into the buildout.

## How it is built

A Python pipeline turns a hand-curated YAML knowledge base into the graph. Every number is stored with its value, unit, date, source and a confidence grade (A for filings and official data, B for company statements, C for press and analysts, D for my own estimates, always shown with a range). Market caps and rates are refreshed from public data. The front end is plain JavaScript with D3, built as a static site.

Public sources only, no paid data. This is a research tool, not investment advice.
