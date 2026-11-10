/* The workflow this app runs: Flux dev with an equirectangular LoRA, then
 * a second pass that makes the picture wrap around.
 *
 * A 2:1 picture from the LoRA looks like a panorama but its left and right
 * edges were drawn apart and do not meet -- in a viewer that is a seam
 * straight down the back. So the first picture is turned half a turn (its
 * two halves swapped, which is a rotation of the sphere, not a change to
 * it), the seam is now down the middle with picture on both sides of it,
 * and a band over it is painted again with differential diffusion. The
 * new edges were the old middle, so they already meet.
 *
 * Only the middle half of the turned picture goes through the second
 * pass, not all of it: the band (an eighth of the width either side of
 * the seam) and as much again of context around it. Sampling the whole
 * width and masking three quarters of it away cost as much as the first
 * pass. The band is a share of the width, not pixels, so it is the same
 * band at 1024 wide as at 2048; set above a quarter it is cut at the
 * crop's edge.
 *
 * Not upscaled from a smaller picture: tried at 1024x512 through
 * RealESRGAN, it ran in 85 s instead of 122 on Qwen, but the LoRAs hold
 * the projection worse at half their training size (a high, wavering
 * horizon) and ESRGAN made every surface plastic.
 *
 * Only core ComfyUI nodes, so what the readiness check asks for is models,
 * not custom nodes. The half width comes from scaling the size image by
 * one half and asking its size -- core has no plain integer maths node --
 * and the seam band is two feathered half masks, stitched and inverted.
 *
 *   1-4    Flux dev, its text encoders, VAE, the panorama LoRA
 *   5-7    the prompt (with Flux guidance) and the negative, unused at cfg 1
 *   8-12   the size, the first pass, decoded
 *   13-17  the half turn
 *   18-27  the seam band: 18 is its width as a share of the picture's
 *          (a setting), 39 that in pixels
 *   35-38  the middle half: its offset (a quarter width, the same way
 *          as the half), the picture and the band mask cropped to it
 *   28-34  the second pass over the middle half, pasted back, the output
 *
 * Regenerated rather than edited by hand, like t2i's.
 */

export const TEMPLATE = {
  "name": "Flux 360°パノラマ",
  "tool": "t2i",
  "workflow": {
    "name": "panorama",
    "platform": "comfyui",
    "graph": {
      "1": {
        "class_type": "UNETLoader",
        "inputs": {
          "unet_name": "flux1-dev-fp8.safetensors",
          "weight_dtype": "default"
        },
        "_meta": {
          "title": "Load Diffusion Model"
        }
      },
      "2": {
        "class_type": "DualCLIPLoader",
        "inputs": {
          "clip_name1": "clip_l.safetensors",
          "clip_name2": "t5xxl_fp16.safetensors",
          "type": "flux"
        },
        "_meta": {
          "title": "Load Text Encoders"
        }
      },
      "3": {
        "class_type": "VAELoader",
        "inputs": {
          "vae_name": "ae.safetensors"
        },
        "_meta": {
          "title": "Load VAE"
        }
      },
      "4": {
        "class_type": "LoraLoaderModelOnly",
        "inputs": {
          "lora_name": "equirectangular_flux_lora_v3.safetensors",
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
      "6": {
        "class_type": "FluxGuidance",
        "inputs": {
          "guidance": 3.5,
          "conditioning": [
            "5",
            0
          ]
        },
        "_meta": {
          "title": "Flux Guidance"
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
          "steps": 25,
          "cfg": 1,
          "sampler_name": "euler",
          "scheduler": "simple",
          "denoise": 1,
          "model": [
            "4",
            0
          ],
          "positive": [
            "6",
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
            "4",
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
          "steps": 12,
          "cfg": 1,
          "sampler_name": "euler",
          "scheduler": "simple",
          "denoise": 0.8,
          "model": [
            "30",
            0
          ],
          "positive": [
            "6",
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
      "input_key": "clip_name1",
      "label": "テキストエンコーダー 1",
      "group": "モデル",
      "options_source": {
        "class_type": "DualCLIPLoader",
        "input_key": "clip_name1"
      }
    },
    {
      "node_id": "2",
      "input_key": "clip_name2",
      "label": "テキストエンコーダー 2",
      "group": "モデル",
      "options_source": {
        "class_type": "DualCLIPLoader",
        "input_key": "clip_name2"
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
      "node_id": "6",
      "input_key": "guidance",
      "label": "ガイダンス",
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
