/* The workflow this app runs, and how its fields are joined to what the
 * tool asks for -- promptmanager's "Anima VACE Depth ControlNet" template
 * for its 3D-pose page, exported here as a module rather than saved in the
 * library.
 *
 * The depth picture the scene window draws goes into LoadImage (34); the
 * resize node (22) brings it to the size asked for, and the empty latent
 * takes that size from it (5 -> 4), so the size block is written there and
 * nowhere else. The ControlNet is VACE depth through Advanced-ControlNet,
 * with a keyframe curve (28) that holds the depth hard early and lets go.
 *
 * LoadImage's picture name is blanked: an exported graph carries whatever
 * it last ran on, and a name that exists only on the machine it was
 * exported from fails validation everywhere else.
 */

export const TEMPLATE = {
  "name": "Anima VACE Depth 3Dポーズ生成",
  "tool": "scene_3d_generation",
  "workflow": {
    "name": "Anima VACE Depth ControlNet",
    "platform": "comfyui",
    "graph": {
      "1": {
        "inputs": {
          "strength": 1,
          "start_percent": 0,
          "end_percent": 1,
          "positive": [
            "24",
            0
          ],
          "negative": [
            "18",
            0
          ],
          "control_net": [
            "26",
            0
          ],
          "image": [
            "22",
            0
          ],
          "timestep_kf": [
            "28",
            0
          ],
          "vae_optional": [
            "6",
            0
          ]
        },
        "class_type": "ACN_AdvancedControlNetApply_v2",
        "_meta": {
          "title": "Apply Advanced ControlNet 🛂🅐🅒🅝"
        }
      },
      "3": {
        "inputs": {
          "lora_name": "anima-turbo-lora-v0.2.safetensors",
          "strength_model": 1,
          "model": [
            "8",
            0
          ]
        },
        "class_type": "LoraLoaderModelOnly",
        "_meta": {
          "title": "Load LoRA (anima-turbo)"
        }
      },
      "4": {
        "inputs": {
          "width": [
            "5",
            0
          ],
          "height": [
            "5",
            1
          ],
          "batch_size": 1
        },
        "class_type": "EmptyLatentImage",
        "_meta": {
          "title": "Empty Latent Image"
        }
      },
      "5": {
        "inputs": {
          "image": [
            "22",
            0
          ]
        },
        "class_type": "GetImageSize",
        "_meta": {
          "title": "Get Image Size"
        }
      },
      "6": {
        "inputs": {
          "vae_name": "qwen_image_vae.safetensors"
        },
        "class_type": "VAELoader",
        "_meta": {
          "title": "Load VAE"
        }
      },
      "7": {
        "inputs": {
          "clip_name": "qwen_3_06b_base.safetensors",
          "type": "stable_diffusion",
          "device": "default"
        },
        "class_type": "CLIPLoader",
        "_meta": {
          "title": "Load CLIP"
        }
      },
      "8": {
        "inputs": {
          "unet_name": "anima-base-v1.0.safetensors",
          "weight_dtype": "default"
        },
        "class_type": "UNETLoader",
        "_meta": {
          "title": "Load Diffusion Model"
        }
      },
      "11": {
        "inputs": {
          "images": [
            "30",
            0
          ]
        },
        "class_type": "PreviewImage",
        "_meta": {
          "title": "Preview Image"
        }
      },
      "16": {
        "inputs": {
          "lora_name": "youyume-kun.safetensors",
          "strength_model": 1,
          "model": [
            "35",
            0
          ]
        },
        "class_type": "LoraLoaderModelOnly",
        "_meta": {
          "title": "Load LoRA"
        }
      },
      "18": {
        "inputs": {
          "text": "",
          "clip": [
            "7",
            0
          ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
          "title": "negative"
        }
      },
      "22": {
        "inputs": {
          "resize_type": "scale dimensions",
          "resize_type.width": 1024,
          "resize_type.height": 1024,
          "resize_type.crop": "disabled",
          "scale_method": "area",
          "input": [
            "34",
            0
          ]
        },
        "class_type": "ResizeImageMaskNode",
        "_meta": {
          "title": "Resize Image/Mask"
        }
      },
      "24": {
        "inputs": {
          "text": "",
          "clip": [
            "7",
            0
          ]
        },
        "class_type": "CLIPTextEncode",
        "_meta": {
          "title": "positive"
        }
      },
      "26": {
        "inputs": {
          "cnet": "anima-vace-depth.safetensors"
        },
        "class_type": "ACN_ControlNetLoaderAdvanced",
        "_meta": {
          "title": "Load Advanced ControlNet Model 🛂🅐🅒🅝"
        }
      },
      "28": {
        "inputs": {
          "start_percent": 0,
          "end_percent": 0.4,
          "strength_start": 3,
          "strength_end": 0,
          "interpolation": "ease-in-out",
          "intervals": 10,
          "null_latent_kf_strength": 0,
          "inherit_missing": false,
          "print_keyframes": false
        },
        "class_type": "ACN_TimestepKeyframeInterpolation",
        "_meta": {
          "title": "Timestep Keyframe Interp. 🛂🅐🅒🅝"
        }
      },
      "29": {
        "inputs": {
          "seed": 0,
          "steps": 24,
          "cfg": 1,
          "sampler_name": "euler_ancestral",
          "scheduler": "simple",
          "denoise": 1,
          "model": [
            "16",
            0
          ],
          "positive": [
            "1",
            0
          ],
          "negative": [
            "1",
            1
          ],
          "latent_image": [
            "4",
            0
          ]
        },
        "class_type": "KSampler",
        "_meta": {
          "title": "KSampler"
        }
      },
      "30": {
        "inputs": {
          "samples": [
            "29",
            0
          ],
          "vae": [
            "6",
            0
          ]
        },
        "class_type": "VAEDecode",
        "_meta": {
          "title": "VAE Decode"
        }
      },
      "34": {
        "inputs": {
          "image": ""
        },
        "class_type": "LoadImage",
        "_meta": {
          "title": "Load Image"
        }
      },
      "35": {
        "inputs": {
          "preview_method": "auto",
          "model": [
            "3",
            0
          ]
        },
        "class_type": "SetPreviewMethod",
        "_meta": {
          "title": "Set Preview Method"
        }
      }
    },
    "fields": []
  },
  "blocks": {
    "prompts": {
      "value": {
        "node_id": "24",
        "input_key": "text"
      }
    },
    "negative_prompts": {
      "value": {
        "node_id": "18",
        "input_key": "text"
      }
    },
    "depth_image": {
      "value": {
        "node_id": "34",
        "input_key": "image"
      }
    },
    "image_size": {
      "width": {
        "node_id": "22",
        "input_key": "resize_type.width"
      },
      "height": {
        "node_id": "22",
        "input_key": "resize_type.height"
      }
    },
    "image": {
      "value": {
        "node_id": "11",
        "input_key": "images"
      }
    }
  },
  "settings": [
    {
      "node_id": "8",
      "input_key": "unet_name",
      "label": "モデル",
      "group": "モデル",
      "options_source": {
        "class_type": "UNETLoader",
        "input_key": "unet_name"
      }
    },
    {
      "node_id": "6",
      "input_key": "vae_name",
      "label": "VAE",
      "group": "モデル",
      "options_source": {
        "class_type": "VAELoader",
        "input_key": "vae_name"
      }
    },
    {
      "node_id": "7",
      "input_key": "clip_name",
      "label": "CLIP",
      "group": "モデル",
      "options_source": {
        "class_type": "CLIPLoader",
        "input_key": "clip_name"
      }
    },
    {
      "node_id": "26",
      "input_key": "cnet",
      "label": "ControlNet モデル",
      "group": "モデル",
      "options_source": {
        "class_type": "ACN_ControlNetLoaderAdvanced",
        "input_key": "cnet"
      }
    },
    {
      "node_id": "3",
      "input_key": "lora_name",
      "label": "LoRA 1",
      "group": "LoRA",
      "options_source": {
        "class_type": "LoraLoaderModelOnly",
        "input_key": "lora_name"
      }
    },
    {
      "node_id": "3",
      "input_key": "strength_model",
      "label": "LoRA 1 の強さ",
      "group": "LoRA",
      "value_type": "number"
    },
    {
      "node_id": "16",
      "input_key": "lora_name",
      "label": "LoRA 2",
      "group": "LoRA",
      "options_source": {
        "class_type": "LoraLoaderModelOnly",
        "input_key": "lora_name"
      }
    },
    {
      "node_id": "16",
      "input_key": "strength_model",
      "label": "LoRA 2 の強さ",
      "group": "LoRA",
      "value_type": "number"
    },
    {
      "node_id": "1",
      "input_key": "strength",
      "label": "ControlNet の強さ",
      "group": "ControlNet",
      "value_type": "number"
    },
    {
      "node_id": "1",
      "input_key": "start_percent",
      "label": "ControlNet 開始位置",
      "group": "ControlNet",
      "value_type": "number"
    },
    {
      "node_id": "1",
      "input_key": "end_percent",
      "label": "ControlNet 終了位置",
      "group": "ControlNet",
      "value_type": "number"
    },
    {
      "node_id": "28",
      "input_key": "strength_start",
      "label": "Depth の強さ (開始)",
      "group": "ControlNet",
      "value_type": "number"
    },
    {
      "node_id": "28",
      "input_key": "strength_end",
      "label": "Depth の強さ (終了)",
      "group": "ControlNet",
      "value_type": "number"
    },
    {
      "node_id": "28",
      "input_key": "end_percent",
      "label": "Depth の適用範囲",
      "group": "ControlNet",
      "value_type": "number"
    },
    {
      "node_id": "29",
      "input_key": "steps",
      "label": "ステップ数",
      "group": "サンプラー",
      "value_type": "integer"
    },
    {
      "node_id": "29",
      "input_key": "cfg",
      "label": "CFG",
      "group": "サンプラー",
      "value_type": "number"
    },
    {
      "node_id": "29",
      "input_key": "sampler_name",
      "label": "サンプラー",
      "group": "サンプラー",
      "options_source": {
        "class_type": "KSampler",
        "input_key": "sampler_name"
      }
    },
    {
      "node_id": "29",
      "input_key": "scheduler",
      "label": "スケジューラー",
      "group": "サンプラー",
      "options_source": {
        "class_type": "KSampler",
        "input_key": "scheduler"
      }
    },
    {
      "node_id": "29",
      "input_key": "denoise",
      "label": "デノイズ",
      "group": "サンプラー",
      "value_type": "number"
    }
  ],
  "fixed": []
};
