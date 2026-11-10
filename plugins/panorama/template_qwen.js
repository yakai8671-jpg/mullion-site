/* The same app on Qwen-Image 2512: qwen-360-diffusion for the panorama and
 * the Lightning LoRA to make it in 8 steps rather than 20-odd.
 *
 * The graph is template.js's with the model half swapped -- one text
 * encoder instead of Flux's two, no Flux guidance, ModelSamplingAuraFlow
 * after the LoRAs -- and the seam half unchanged: 8-34 are the same nodes
 * with the same ids, so what is said about them there holds here.
 *
 * Why 8 steps with Lightning for the first pass, when it is sold as 4: at
 * 4 the whole picture comes out with a cross-hatched grain. At 8 it is
 * clean. The seam pass, on the middle half only, is clean at 4. Without
 * Lightning (20 steps, cfg 2.5) it took four times as long and the fp8
 * model's grain on flat stone was still there, so it is not the LoRA's.
 * Its strength is a setting: 0 and more steps turns it off.
 *
 * What a run costs on an 8 GB card: the model is 19.5 GB, so every step
 * streams it to the GPU, and a step is 9 s at 2048x1024 whatever the LoRAs
 * (8.2 s without them) -- 6 s at 1536x768 or on the middle half. So the
 * lever is the number of steps: 8 + 4 is about two minutes.
 *
 *   1-3    Qwen-Image 2512, its text encoder, VAE
 *   4, 40  the 360° LoRA, the Lightning LoRA
 *   41     the sampling shift
 *   5, 7   the prompt, and the negative, unused at cfg 1
 *   8-38   as in template.js: size, first pass, half turn, seam band,
 *          the middle half, second pass, output
 *
 * Regenerated rather than edited by hand.
 */

export const TEMPLATE = {
  "name": "Qwen-Image 360°パノラマ",
  "tool": "t2i",
  "workflow": {
    "name": "panorama_qwen",
    "platform": "comfyui",
    "graph": {
      "1": {
        "class_type": "UNETLoader",
        "inputs": {
          "unet_name": "qwen_image_2512_fp8_e4m3fn.safetensors",
          "weight_dtype": "default"
        },
        "_meta": {
          "title": "Load Diffusion Model"
        }
      },
      "2": {
        "class_type": "CLIPLoader",
        "inputs": {
          "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
          "type": "qwen_image",
          "device": "default"
        },
        "_meta": {
          "title": "Load Text Encoder"
        }
      },
      "3": {
        "class_type": "VAELoader",
        "inputs": {
          "vae_name": "qwen_image_vae.safetensors"
        },
        "_meta": {
          "title": "Load VAE"
        }
      },
      "4": {
        "class_type": "LoraLoaderModelOnly",
        "inputs": {
          "lora_name": "qwen-360-diffusion-2512-int8-bf16-v2.safetensors",
          "strength_model": 1,
          "model": [
            "1",
            0
          ]
        },
        "_meta": {
          "title": "Load LoRA (panorama)"
        }
      },
      "5": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "text": "",
          "clip": [
            "2",
            0
          ]
        },
        "_meta": {
          "title": "Prompt"
        }
      },
      "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {
          "text": "",
          "clip": [
            "2",
            0
          ]
        },
        "_meta": {
          "title": "Negative Prompt"
        }
      },
      "8": {
        "class_type": "EmptyImage",
        "inputs": {
          "width": 2048,
          "height": 1024,
          "batch_size": 1,
          "color": 0
        },
        "_meta": {
          "title": "Size"
        }
      },
      "9": {
        "class_type": "GetImageSize",
        "inputs": {
          "image": [
            "8",
            0
          ]
        },
        "_meta": {
          "title": "Get Image Size"
        }
      },
      "10": {
        "class_type": "EmptySD3LatentImage",
        "inputs": {
          "width": [
            "9",
            0
          ],
          "height": [
            "9",
            1
          ],
          "batch_size": 1
        },
        "_meta": {
          "title": "Empty Latent"
        }
      },
      "11": {
        "class_type": "KSampler",
        "inputs": {
          "seed": 1,
          "steps": 8,
          "cfg": 1,
          "sampler_name": "euler",
          "scheduler": "simple",
          "denoise": 1,
          "model": [
            "41",
            0
          ],
          "positive": [
            "5",
            0
          ],
          "negative": [
            "7",
            0
          ],
          "latent_image": [
            "10",
            0
          ]
        },
        "_meta": {
          "title": "KSampler (panorama)"
        }
      },
      "12": {
        "class_type": "VAEDecode",
        "inputs": {
          "samples": [
            "11",
            0
          ],
          "vae": [
            "3",
            0
          ]
        },
        "_meta": {
          "title": "VAE Decode"
        }
      },
      "13": {
        "class_type": "ImageScaleBy",
        "inputs": {
          "image": [
            "8",
            0
          ],
          "upscale_method": "nearest-exact",
          "scale_by": 0.5
        },
        "_meta": {
          "title": "Half Size"
        }
      },
      "14": {
        "class_type": "GetImageSize",
        "inputs": {
          "image": [
            "13",
            0
          ]
        },
        "_meta": {
          "title": "Get Half Size"
        }
      },
      "15": {
        "class_type": "ImageCrop",
        "inputs": {
          "image": [
            "12",
            0
          ],
          "width": [
            "14",
            0
          ],
          "height": [
            "9",
            1
          ],
          "x": 0,
          "y": 0
        },
        "_meta": {
          "title": "Left Half"
        }
      },
      "16": {
        "class_type": "ImageCrop",
        "inputs": {
          "image": [
            "12",
            0
          ],
          "width": [
            "14",
            0
          ],
          "height": [
            "9",
            1
          ],
          "x": [
            "14",
            0
          ],
          "y": 0
        },
        "_meta": {
          "title": "Right Half"
        }
      },
      "17": {
        "class_type": "ImageStitch",
        "inputs": {
          "image1": [
            "16",
            0
          ],
          "image2": [
            "15",
            0
          ],
          "direction": "right",
          "match_image_size": false,
          "spacing_width": 0,
          "spacing_color": "white"
        },
        "_meta": {
          "title": "Roll Half Turn"
        }
      },
      "18": {
        "class_type": "ImageScaleBy",
        "inputs": {
          "image": [
            "8",
            0
          ],
          "upscale_method": "nearest-exact",
          "scale_by": 0.125
        },
        "_meta": {
          "title": "Seam Width (of the width)"
        }
      },
      "19": {
        "class_type": "SolidMask",
        "inputs": {
          "value": 1,
          "width": [
            "14",
            0
          ],
          "height": [
            "9",
            1
          ]
        },
        "_meta": {
          "title": "Half Mask"
        }
      },
      "20": {
        "class_type": "FeatherMask",
        "inputs": {
          "mask": [
            "19",
            0
          ],
          "left": 0,
          "top": 0,
          "right": [
            "39",
            0
          ],
          "bottom": 0
        },
        "_meta": {
          "title": "Feather Right Edge"
        }
      },
      "21": {
        "class_type": "FeatherMask",
        "inputs": {
          "mask": [
            "19",
            0
          ],
          "left": [
            "39",
            0
          ],
          "top": 0,
          "right": 0,
          "bottom": 0
        },
        "_meta": {
          "title": "Feather Left Edge"
        }
      },
      "22": {
        "class_type": "MaskToImage",
        "inputs": {
          "mask": [
            "20",
            0
          ]
        },
        "_meta": {
          "title": "Mask To Image"
        }
      },
      "23": {
        "class_type": "MaskToImage",
        "inputs": {
          "mask": [
            "21",
            0
          ]
        },
        "_meta": {
          "title": "Mask To Image"
        }
      },
      "24": {
        "class_type": "ImageStitch",
        "inputs": {
          "image1": [
            "22",
            0
          ],
          "image2": [
            "23",
            0
          ],
          "direction": "right",
          "match_image_size": false,
          "spacing_width": 0,
          "spacing_color": "white"
        },
        "_meta": {
          "title": "Join Masks"
        }
      },
      "25": {
        "class_type": "ImageToMask",
        "inputs": {
          "image": [
            "24",
            0
          ],
          "channel": "red"
        },
        "_meta": {
          "title": "Image To Mask"
        }
      },
      "26": {
        "class_type": "InvertMask",
        "inputs": {
          "mask": [
            "25",
            0
          ]
        },
        "_meta": {
          "title": "Seam Band"
        }
      },
      "27": {
        "class_type": "MaskComposite",
        "inputs": {
          "destination": [
            "26",
            0
          ],
          "source": [
            "26",
            0
          ],
          "x": 0,
          "y": 0,
          "operation": "add"
        },
        "_meta": {
          "title": "Widen Seam Band"
        }
      },
      "28": {
        "class_type": "VAEEncode",
        "inputs": {
          "pixels": [
            "37",
            0
          ],
          "vae": [
            "3",
            0
          ]
        },
        "_meta": {
          "title": "VAE Encode"
        }
      },
      "29": {
        "class_type": "SetLatentNoiseMask",
        "inputs": {
          "samples": [
            "28",
            0
          ],
          "mask": [
            "38",
            0
          ]
        },
        "_meta": {
          "title": "Set Latent Noise Mask"
        }
      },
      "30": {
        "class_type": "DifferentialDiffusion",
        "inputs": {
          "model": [
            "41",
            0
          ]
        },
        "_meta": {
          "title": "Differential Diffusion"
        }
      },
      "31": {
        "class_type": "KSampler",
        "inputs": {
          "seed": 1,
          "steps": 4,
          "cfg": 1,
          "sampler_name": "euler",
          "scheduler": "simple",
          "denoise": 0.8,
          "model": [
            "30",
            0
          ],
          "positive": [
            "5",
            0
          ],
          "negative": [
            "7",
            0
          ],
          "latent_image": [
            "29",
            0
          ]
        },
        "_meta": {
          "title": "KSampler (seam)"
        }
      },
      "32": {
        "class_type": "VAEDecode",
        "inputs": {
          "samples": [
            "31",
            0
          ],
          "vae": [
            "3",
            0
          ]
        },
        "_meta": {
          "title": "VAE Decode (seam)"
        }
      },
      "33": {
        "class_type": "ImageCompositeMasked",
        "inputs": {
          "destination": [
            "17",
            0
          ],
          "source": [
            "32",
            0
          ],
          "x": [
            "36",
            0
          ],
          "y": 0,
          "resize_source": false,
          "mask": [
            "38",
            0
          ]
        },
        "_meta": {
          "title": "Paste Seam"
        }
      },
      "34": {
        "class_type": "PreviewImage",
        "inputs": {
          "images": [
            "33",
            0
          ]
        },
        "_meta": {
          "title": "Preview Image"
        }
      },
      "35": {
        "class_type": "ImageScaleBy",
        "inputs": {
          "image": [
            "8",
            0
          ],
          "upscale_method": "nearest-exact",
          "scale_by": 0.25
        },
        "_meta": {
          "title": "Quarter Size"
        }
      },
      "36": {
        "class_type": "GetImageSize",
        "inputs": {
          "image": [
            "35",
            0
          ]
        },
        "_meta": {
          "title": "Get Quarter Size"
        }
      },
      "37": {
        "class_type": "ImageCrop",
        "inputs": {
          "image": [
            "17",
            0
          ],
          "width": [
            "14",
            0
          ],
          "height": [
            "9",
            1
          ],
          "x": [
            "36",
            0
          ],
          "y": 0
        },
        "_meta": {
          "title": "Middle Half"
        }
      },
      "38": {
        "class_type": "CropMask",
        "inputs": {
          "mask": [
            "27",
            0
          ],
          "x": [
            "36",
            0
          ],
          "y": 0,
          "width": [
            "14",
            0
          ],
          "height": [
            "9",
            1
          ]
        },
        "_meta": {
          "title": "Middle Half Of Band"
        }
      },
      "39": {
        "class_type": "GetImageSize",
        "inputs": {
          "image": [
            "18",
            0
          ]
        },
        "_meta": {
          "title": "Get Seam Width"
        }
      },
      "40": {
        "class_type": "LoraLoaderModelOnly",
        "inputs": {
          "lora_name": "Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors",
          "strength_model": 1,
          "model": [
            "4",
            0
          ]
        },
        "_meta": {
          "title": "Load LoRA (Lightning)"
        }
      },
      "41": {
        "class_type": "ModelSamplingAuraFlow",
        "inputs": {
          "shift": 3.1,
          "model": [
            "40",
            0
          ]
        },
        "_meta": {
          "title": "Model Sampling"
        }
      }
    },
    "fields": []
  },
  "blocks": {
    "prompts": {
      "value": {
        "node_id": "5",
        "input_key": "text"
      }
    },
    "negative_prompts": {
      "value": {
        "node_id": "7",
        "input_key": "text"
      }
    },
    "image_size": {
      "width": {
        "node_id": "8",
        "input_key": "width"
      },
      "height": {
        "node_id": "8",
        "input_key": "height"
      }
    },
    "image": {
      "value": {
        "node_id": "34",
        "input_key": "images"
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
      "node_id": "2",
      "input_key": "clip_name",
      "label": "テキストエンコーダー",
      "group": "モデル",
      "options_source": {
        "class_type": "CLIPLoader",
        "input_key": "clip_name"
      }
    },
    {
      "node_id": "3",
      "input_key": "vae_name",
      "label": "VAE",
      "group": "モデル",
      "options_source": {
        "class_type": "VAELoader",
        "input_key": "vae_name"
      }
    },
    {
      "node_id": "4",
      "input_key": "lora_name",
      "label": "パノラマ LoRA",
      "group": "LoRA",
      "options_source": {
        "class_type": "LoraLoaderModelOnly",
        "input_key": "lora_name"
      }
    },
    {
      "node_id": "4",
      "input_key": "strength_model",
      "label": "パノラマ LoRA の強さ",
      "group": "LoRA",
      "value_type": "number"
    },
    {
      "node_id": "40",
      "input_key": "lora_name",
      "label": "高速化 LoRA (Lightning)",
      "group": "LoRA",
      "options_source": {
        "class_type": "LoraLoaderModelOnly",
        "input_key": "lora_name"
      }
    },
    {
      "node_id": "40",
      "input_key": "strength_model",
      "label": "高速化 LoRA の強さ",
      "group": "LoRA",
      "value_type": "number"
    },
    {
      "node_id": "41",
      "input_key": "shift",
      "label": "シフト",
      "group": "サンプラー",
      "value_type": "number"
    },
    {
      "node_id": "11",
      "input_key": "steps",
      "label": "ステップ数",
      "group": "サンプラー",
      "value_type": "integer"
    },
    {
      "node_id": "11",
      "input_key": "cfg",
      "label": "CFG",
      "group": "サンプラー",
      "value_type": "number"
    },
    {
      "node_id": "11",
      "input_key": "sampler_name",
      "label": "サンプラー",
      "group": "サンプラー",
      "options_source": {
        "class_type": "KSampler",
        "input_key": "sampler_name"
      }
    },
    {
      "node_id": "11",
      "input_key": "scheduler",
      "label": "スケジューラー",
      "group": "サンプラー",
      "options_source": {
        "class_type": "KSampler",
        "input_key": "scheduler"
      }
    },
    {
      "node_id": "18",
      "input_key": "scale_by",
      "label": "継ぎ目の幅（横幅に対する比率）",
      "group": "継ぎ目",
      "value_type": "number"
    },
    {
      "node_id": "31",
      "input_key": "denoise",
      "label": "継ぎ目の描き直しの強さ",
      "group": "継ぎ目",
      "value_type": "number"
    },
    {
      "node_id": "31",
      "input_key": "steps",
      "label": "継ぎ目のステップ数",
      "group": "継ぎ目",
      "value_type": "integer"
    }
  ],
  "fixed": []
};
