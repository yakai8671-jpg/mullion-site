# Where the bundled assets come from

Carried over from promptmanager's 3D scene plugin (`static/plugins/scene-3d/samples`).

- `models/sample_model.vrm` -- pixiv/three-vrm's example model
  (`packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm`),
  Copyright (c) 2022 pixiv Inc., VRM License 1.0. Its metadata allows
  redistribution and modification; credit is not required but given here.
- `models/sample.vrm` -- the sample model promptmanager imported by default.
- `poses/pose_attention.vrma`, `pose_banzai.vrma`, `pose_wave.vrma` --
  made in promptmanager (upper-body rotations only); no third-party work.
- `poses/pose01.vrma` ... `pose15.vrma` -- promptmanager's `POSE01..15.vroidpose`
  samples, converted once with its `vroidpose_to_vrma.py`.

The libraries under `../vendor/` (three.js, three-vrm, three-vrm-animation)
keep their own LICENSE files.
