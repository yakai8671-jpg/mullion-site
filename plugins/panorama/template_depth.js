/* The workflow the panorama depth app runs: MoGe-2's panorama inference,
 * in core ComfyUI.
 *
 * MoGePanoramaInference cuts the panorama into twelve views, finds the
 * depth of each and joins them into one distance per pixel. Three things
 * are read back:
 *
 *   8      the panorama as it went in, so the output is the pair of them
 *          and a history entry holds the picture its depth belongs to
 *   6-7    the depth drawn as colours, to look at
 *   4-5    the depth itself: the point grid MoGePointMapToMesh makes of
 *          it, every other pixel, nothing dropped (discontinuity
 *          threshold 0), saved as a GLB -- what geometry.js reads
 *
 * refine_steps is MoGe-3's own pass, which ComfyUI's node now asks for
 * whatever the model (a run without it is refused for the missing input,
 * and the outputs that depended on it are dropped without a word); MoGe-2
 * ignores it, and 0 says so.
 *
 * merge_resolution is set past any picture this app is given, so the
 * distances are not resampled: the sky keeps the one far value MoGe gives
 * it, which is how geometry.js knows it for sky.
 */

export const TEMPLATE = {
  "name": "MoGe-2 パノラマ奥行き推定",
  "tool": "panorama_depth",
  "workflow": {
    "name": "panorama_depth",
    "platform": "comfyui",
    "graph": {
      "1": {
        "inputs": {
          "image": ""
        },
        "class_type": "LoadImage",
        "_meta": {
          "title": "Load Image"
        }
      },
      "2": {
        "inputs": {
          "model_name": "moge_2_vitl_normal_fp16.safetensors"
        },
        "class_type": "LoadMoGeModel",
        "_meta": {
          "title": "Load MoGe Model"
        }
      },
      "3": {
        "inputs": {
          "moge_model": ["2", 0],
          "image": ["1", 0],
          "resolution_level": 9,
          "split_resolution": 512,
          "merge_resolution": 4096,
          "batch_size": 4,
          "refine_steps": 0
        },
        "class_type": "MoGePanoramaInference",
        "_meta": {
          "title": "Run MoGe Panorama Inference"
        }
      },
      "4": {
        "inputs": {
          "moge_geometry": ["3", 0],
          "batch_index": 0,
          "decimation": 2,
          "discontinuity_threshold": 0,
          "texture": false
        },
        "class_type": "MoGePointMapToMesh",
        "_meta": {
          "title": "MoGe Point Map to Mesh"
        }
      },
      "5": {
        "inputs": {
          "mesh": ["4", 0],
          "filename_prefix": "Mullion/panorama_depth"
        },
        "class_type": "SaveGLB",
        "_meta": {
          "title": "Save GLB"
        }
      },
      "6": {
        "inputs": {
          "moge_geometry": ["3", 0],
          "output": "depth_colored"
        },
        "class_type": "MoGeRender",
        "_meta": {
          "title": "MoGe Render"
        }
      },
      "7": {
        "inputs": {
          "images": ["6", 0]
        },
        "class_type": "PreviewImage",
        "_meta": {
          "title": "Preview Depth"
        }
      },
      "8": {
        "inputs": {
          "images": ["1", 0]
        },
        "class_type": "PreviewImage",
        "_meta": {
          "title": "Preview Panorama"
        }
      }
    },
    "fields": []
  },
  "blocks": {
    "source_image": {
      "value": {
        "node_id": "1",
        "input_key": "image"
      }
    },
    "panorama": {
      "value": {
        "node_id": "8",
        "input_key": "images"
      }
    },
    "depth_image": {
      "value": {
        "node_id": "7",
        "input_key": "images"
      }
    },
    "structure": {
      "value": {
        "node_id": "5",
        "input_key": "mesh"
      }
    }
  },
  "settings": [
    {
      "node_id": "2",
      "input_key": "model_name",
      "label": "モデル",
      "group": "モデル",
      "options_source": {
        "class_type": "LoadMoGeModel",
        "input_key": "model_name"
      }
    },
    {
      "node_id": "3",
      "input_key": "resolution_level",
      "label": "細かさ (0-9)",
      "value_type": "integer",
      "group": "推定"
    },
    {
      "node_id": "3",
      "input_key": "split_resolution",
      "label": "分割ビューの解像度",
      "value_type": "integer",
      "group": "推定"
    }
  ],
  "fixed": []
};
