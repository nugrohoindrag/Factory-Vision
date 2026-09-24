"""Factory Vision camera analytics worker.

Turns one camera stream into a people count, crowd alerts, potential-weapon
alerts for an operator to verify, and vehicle density per road zone. The
first camera is the DKI public CCTV at Gatot Subroto C11 (the Crowd Safety
Vision prototype); a plant camera reuses the same pieces later.
"""

import os

__version__ = "0.1.0"

# FFmpeg options for every capture this package opens, set before OpenCV is
# first used (the variable is read when a capture opens):
#   live_start_index -1  start a live HLS stream at its newest segment. The
#                        default, three back, puts a camera with 7.5 s
#                        segments ~28 s behind before anything else adds delay
#                        (measured; PRD: <= 30 s end to end).
#   extension_picky 0    FFmpeg >= 7.1, as bundled in the Linux opencv wheels,
#                        refuses HLS segments named *.fmp4 (the DKI / Bali
#                        Tower cameras) as an unexpected extension.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS",
                      "live_start_index;-1|extension_picky;0")
