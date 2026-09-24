"""Per-track state and the analytics built on it.

- crowd      (F1, F2): people in the whole frame, riders excluded; count and
                       growth alerts
- weapon     (F3):     potential sharp weapon on large person crops, for an
                       operator to verify (F4)
- congestion:          vehicle density per road zone (lancar / padat / macet)

For a plant camera the same pieces are headcount per area, a second-stage
check on person crops (PPE rather than weapons), and density of a WIP buffer.
"""
