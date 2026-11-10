/* MiniMax H3 -- a prompt in, a few seconds of video *with its sound* out,
 * from a first frame, a last frame, both, or neither.
 *
 * The tool's reference pictures are left unassigned here: this checkpoint
 * (fl2va) does not take them -- the app's other engine (template_r2v.js)
 * does, and the run settings offer them only while it is chosen.
 *
 * The user's own ComfyUI workflow (video_minimax_h3_i2v.json), wired the
 * way the turbo node pack says: pruned int8 base -> MiniMax-H3 Turbo LoRA
 * -> BasicGuider, MiniMaxH3TurboSampler (it steps video and audio on their
 * own schedules -- a stock sampler blows the audio out at 4 steps) and a
 * `simple` BasicScheduler at 4 steps. EasyCache, bypassed there, is left
 * out. H3 has no negative prompt and runs at cfg 1.
 *
 * The length is asked for in seconds (node 6) and snapped by node 7 to the
 * model's 17k+5 frame grid at 24 fps, the expression the workflow had.
 * One latent carries both picture and sound: node 14 decodes the video,
 * node 15 the audio, and SaveVideo writes them together as an mp4.
 *
 * The size asked for is two PrimitiveInt nodes (40, 41); the conditioning
 * node is made at it and every picture is cropped to it (21, 24, and the
 * keyframes'). The start (20-21) and end (23-24) pictures go into
 * MiniMaxH3ImageToVideo's own first_frame / last_frame, and both are
 * optional (tool `frames2v`): one left empty is taken out by the runner and
 * its input is not connected -- with neither, it is text to video.
 *
 * Keyframes in between are MiniMaxH3AddGuide, one per picture, chained on
 * the conditioning (27 -> 30 -> 33 -> the guider), each anchoring its
 * picture at its own frame (24 fps). A keyframe left empty is stepped
 * over: `_meta.passThrough` hands its `positive` on in its place.
 */

export const TEMPLATE = {
  "name": "MiniMax H3 動画生成（開始・終了・キーフレーム画像はどれも省略可、音声付き）",
  "tool": "frames2v",
  "workflow": {
    "name": "minimax h3 turbo i2v",
    "platform": "comfyui",
    "graph": {
      "1": {
        "inputs": {
          "unet_name": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
          "weight_dtype": "default"
        },
        "class_type": "UNETLoader",
        "_meta": {
          "title": "Load Diffusion Model"
        }
      },
      "2": {
        "inputs": {
          "model": [
            "1",
            0
          ],
          "lora_name": "minimax_h3_turbo_4step_ckpt500_pruned_comfyui.safetensors",
          "strength": 1
        },
        "class_type": "MiniMaxH3TurboLoRA",
        "_meta": {
          "title": "Turbo LoRA"
        }
      },
      "3": {
        "inputs": {
          "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
          "type": "minimax",
          "device": "default"
        },
        "class_type": "CLIPLoader",
        "_meta": {
          "title": "Load Text Encoder"
        }
      },
      "4": {
        "inputs": {
          "vae_name": "minimax_h3_video_vae_fp16.safetensors"
        },
        "class_type": "VAELoader",
        "_meta": {
          "title": "Video VAE"
        }
      },
      "5": {
        "inputs": {
          "vae_name": "minimax_h3_audio_vae_fp32.safetensors"
        },
        "class_type": "VAELoader",
        "_meta": {
          "title": "Audio VAE"
        }
      },
      "6": {
        "inputs": {
          "value": 5
        },
        "class_type": "PrimitiveFloat",
        "_meta": {
          "title": "Seconds"
        }
      },
      "7": {
        "inputs": {
          "expression": "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17",
          "values.a": [
            "6",
            0
          ]
        },
        "class_type": "ComfyMathExpression",
        "_meta": {
          "title": "Seconds To Frames"
        }
      },
      "8": {
        "inputs": {
          "clip": [
            "3",
            0
          ],
          "vae": [
            "4",
            0
          ],
          "prompt": "",
          "width": [
            "40",
            0
          ],
          "height": [
            "41",
            0
          ],
          "length": [
            "7",
            1
          ],
          "first_frame": [
            "21",
            0
          ],
          "last_frame": [
            "24",
            0
          ]
        },
        "class_type": "MiniMaxH3ImageToVideo",
        "_meta": {
          "title": "MiniMax H3 Conditioning"
        }
      },
      "9": {
        "inputs": {
          "noise_seed": 0
        },
        "class_type": "RandomNoise",
        "_meta": {
          "title": "Noise"
        }
      },
      "10": {
        "inputs": {
          "model": [
            "2",
            0
          ],
          "conditioning": [
            "33",
            0
          ]
        },
        "class_type": "BasicGuider",
        "_meta": {
          "title": "Guider"
        }
      },
      "11": {
        "inputs": {},
        "class_type": "MiniMaxH3TurboSampler",
        "_meta": {
          "title": "Turbo Sampler"
        }
      },
      "12": {
        "inputs": {
          "model": [
            "2",
            0
          ],
          "scheduler": "simple",
          "steps": 4,
          "denoise": 1
        },
        "class_type": "BasicScheduler",
        "_meta": {
          "title": "Scheduler"
        }
      },
      "13": {
        "inputs": {
          "noise": [
            "9",
            0
          ],
          "guider": [
            "10",
            0
          ],
          "sampler": [
            "11",
            0
          ],
          "sigmas": [
            "12",
            0
          ],
          "latent_image": [
            "8",
            1
          ]
        },
        "class_type": "SamplerCustomAdvanced",
        "_meta": {
          "title": "Sampler"
        }
      },
      "14": {
        "inputs": {
          "samples": [
            "13",
            0
          ],
          "vae": [
            "4",
            0
          ]
        },
        "class_type": "VAEDecode",
        "_meta": {
          "title": "Decode Video"
        }
      },
      "15": {
        "inputs": {
          "samples": [
            "13",
            0
          ],
          "vae": [
            "5",
            0
          ]
        },
        "class_type": "VAEDecodeAudio",
        "_meta": {
          "title": "Decode Audio"
        }
      },
      "16": {
        "inputs": {
          "images": [
            "14",
            0
          ],
          "audio": [
            "15",
            0
          ],
          "fps": 24
        },
        "class_type": "CreateVideo",
        "_meta": {
          "title": "Create Video"
        }
      },
      "17": {
        "inputs": {
          "video": [
            "16",
            0
          ],
          "filename_prefix": "Mullion/h3",
          "format": "auto"
        },
        "class_type": "SaveVideo",
        "_meta": {
          "title": "Save Video"
        }
      },
      "20": {
        "inputs": {
          "image": ""
        },
        "class_type": "LoadImage",
        "_meta": {
          "title": "Start Image"
        }
      },
      "21": {
        "inputs": {
          "image": [
            "20",
            0
          ],
          "upscale_method": "lanczos",
          "width": [
            "40",
            0
          ],
          "height": [
            "41",
            0
          ],
          "crop": "center"
        },
        "class_type": "ImageScale",
        "_meta": {
          "title": "Fit To Size"
        }
      },
      "23": {
        "inputs": {
          "image": ""
        },
        "class_type": "LoadImage",
        "_meta": {
          "title": "End Image"
        }
      },
      "24": {
        "inputs": {
          "image": [
            "23",
            0
          ],
          "upscale_method": "lanczos",
          "width": [
            "40",
            0
          ],
          "height": [
            "41",
            0
          ],
          "crop": "center"
        },
        "class_type": "ImageScale",
        "_meta": {
          "title": "Fit End To Size"
        }
      },
      "25": {
        "inputs": {
          "image": ""
        },
        "class_type": "LoadImage",
        "_meta": {
          "title": "Keyframe 1"
        }
      },
      "26": {
        "inputs": {
          "image": [
            "25",
            0
          ],
          "upscale_method": "lanczos",
          "width": [
            "40",
            0
          ],
          "height": [
            "41",
            0
          ],
          "crop": "center"
        },
        "class_type": "ImageScale",
        "_meta": {
          "title": "Fit Keyframe 1 To Size"
        }
      },
      "27": {
        "inputs": {
          "positive": [
            "8",
            0
          ],
          "latent": [
            "8",
            1
          ],
          "frame_idx": 24,
          "vae": [
            "4",
            0
          ],
          "image": [
            "26",
            0
          ]
        },
        "class_type": "MiniMaxH3AddGuide",
        "_meta": {
          "title": "Place Keyframe 1",
          "passThrough": [
            "positive"
          ]
        }
      },
      "28": {
        "inputs": {
          "image": ""
        },
        "class_type": "LoadImage",
        "_meta": {
          "title": "Keyframe 2"
        }
      },
      "29": {
        "inputs": {
          "image": [
            "28",
            0
          ],
          "upscale_method": "lanczos",
          "width": [
            "40",
            0
          ],
          "height": [
            "41",
            0
          ],
          "crop": "center"
        },
        "class_type": "ImageScale",
        "_meta": {
          "title": "Fit Keyframe 2 To Size"
        }
      },
      "30": {
        "inputs": {
          "positive": [
            "27",
            0
          ],
          "latent": [
            "8",
            1
          ],
          "frame_idx": 48,
          "vae": [
            "4",
            0
          ],
          "image": [
            "29",
            0
          ]
        },
        "class_type": "MiniMaxH3AddGuide",
        "_meta": {
          "title": "Place Keyframe 2",
          "passThrough": [
            "positive"
          ]
        }
      },
      "31": {
        "inputs": {
          "image": ""
        },
        "class_type": "LoadImage",
        "_meta": {
          "title": "Keyframe 3"
        }
      },
      "32": {
        "inputs": {
          "image": [
            "31",
            0
          ],
          "upscale_method": "lanczos",
          "width": [
            "40",
            0
          ],
          "height": [
            "41",
            0
          ],
          "crop": "center"
        },
        "class_type": "ImageScale",
        "_meta": {
          "title": "Fit Keyframe 3 To Size"
        }
      },
      "33": {
        "inputs": {
          "positive": [
            "30",
            0
          ],
          "latent": [
            "8",
            1
          ],
          "frame_idx": 72,
          "vae": [
            "4",
            0
          ],
          "image": [
            "32",
            0
          ]
        },
        "class_type": "MiniMaxH3AddGuide",
        "_meta": {
          "title": "Place Keyframe 3",
          "passThrough": [
            "positive"
          ]
        }
      },
      "40": {
        "inputs": {
          "value": 864
        },
        "class_type": "PrimitiveInt",
        "_meta": {
          "title": "Width"
        }
      },
      "41": {
        "inputs": {
          "value": 480
        },
        "class_type": "PrimitiveInt",
        "_meta": {
          "title": "Height"
        }
      }
    }
  },
  "blocks": {
    "start_image": {
      "value": {
        "node_id": "20",
        "input_key": "image"
      }
    },
    "end_image": {
      "value": {
        "node_id": "23",
        "input_key": "image"
      }
    },
    "prompts": {
      "value": {
        "node_id": "8",
        "input_key": "prompt"
      }
    },
    "image_size": {
      "width": {
        "node_id": "40",
        "input_key": "value"
      },
      "height": {
        "node_id": "41",
        "input_key": "value"
      }
    },
    "video": {
      "value": {
        "node_id": "17",
        "input_key": "video"
      }
    },
    "mid_image_1": {
      "image": {
        "node_id": "25",
        "input_key": "image"
      },
      "frame": {
        "node_id": "27",
        "input_key": "frame_idx"
      }
    },
    "mid_image_2": {
      "image": {
        "node_id": "28",
        "input_key": "image"
      },
      "frame": {
        "node_id": "30",
        "input_key": "frame_idx"
      }
    },
    "mid_image_3": {
      "image": {
        "node_id": "31",
        "input_key": "image"
      },
      "frame": {
        "node_id": "33",
        "input_key": "frame_idx"
      }
    }
  },
  "settings": [
    {
      "node_id": "1",
      "input_key": "unet_name",
      "label": "モデル",
      "group": "モデル",
      "options_source": {
        "class_type": "UNETLoader",
        "input_key": "unet_name"
      }
    },
    {
      "node_id": "3",
      "input_key": "clip_name",
      "label": "テキストエンコーダー",
      "group": "モデル",
      "options_source": {
        "class_type": "CLIPLoader",
        "input_key": "clip_name"
      }
    },
    {
      "node_id": "2",
      "input_key": "lora_name",
      "label": "Turbo LoRA",
      "group": "モデル",
      "options_source": {
        "class_type": "MiniMaxH3TurboLoRA",
        "input_key": "lora_name"
      }
    },
    {
      "node_id": "2",
      "input_key": "strength",
      "label": "Turbo LoRA の強さ",
      "group": "モデル",
      "value_type": "number"
    },
    {
      "node_id": "6",
      "input_key": "value",
      "label": "長さ (秒)",
      "group": "動画",
      "value_type": "number"
    },
    {
      "node_id": "12",
      "input_key": "steps",
      "label": "ステップ数",
      "group": "サンプラー",
      "value_type": "integer"
    }
  ],
  "fixed": []
};
