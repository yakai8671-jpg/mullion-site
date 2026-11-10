/* The second half of the run: the tags the tagger read, sorted.
 *
 * One Ollama node. What makes it more than "ask a model nicely" is that the
 * runner writes a JSON schema into `schema` before sending -- built from the
 * categories chosen for this run, with those categories as an `enum` -- so
 * what comes back is already in groups rather than prose to be parsed. See
 * prepareStep() in the workflow plugin's runner.
 *
 * Two placeholders are filled at run time:
 *   {categories}  the categories, a list of descriptions written out as JSON
 *                 ([{"name": ..., "description": ...}]), into whichever
 *                 prompt mentions it
 *   {input}       promptmanager's own: where the text from the step before
 *                 this one goes (the runner does this for every Ollama
 *                 workflow, not just this one)
 *
 * What the model is asked is not a setting of the template: the app that
 * runs this writes the user prompt itself (its classification prompt), and
 * the system prompt here only says how the answer is to be read. The model
 * is not a setting either -- which model can do this depends on what is
 * installed, so it is chosen per run.
 */

export const CLASSIFY = {
  "name": "タグのカテゴリ分類",
  "tool": "prompt_classify",
  "workflow": {
    "name": "Ollama tag sorter",
    "platform": "ollama",
    "graph": {
      "ollama_generate": {
        "class_type": "OllamaGenerate",
        "inputs": {
          "model": "qwen3.5:latest",
          "system_prompt": "You sort image tags into the categories you are given.\nThe categories are a JSON list of {name, description}: the description says what belongs in the category.\nEvery tag you are given goes into exactly one category, and you invent no new tags.\nUse only the names in that list.",
          "user_prompt": "Sort the tags below into these categories.\n\nCategories (JSON):\n{categories}\n\nTags:\n{input}",
          "image": "",
          "schema": null,
          "temperature": 0.2,
          "num_ctx": 8192
        },
        "_meta": {
          "title": "Ollama Generate"
        }
      },
      "text_output": {
        "class_type": "OllamaTextOutput",
        "inputs": {
          "text": [
            "ollama_generate",
            0
          ]
        },
        "_meta": {
          "title": "Output"
        }
      }
    },
    "fields": []
  },
  "blocks": {
    "tags": {
      "value": {
        "node_id": "ollama_generate",
        "input_key": "user_prompt"
      }
    },
    "candidates": {
      "value": {
        "node_id": "text_output",
        "input_key": "text"
      }
    }
  },
  "settings": [
    {
      "node_id": "ollama_generate",
      "input_key": "temperature",
      "label": "温度",
      "value_type": "number",
      "group": "Ollamaの設定"
    },
    {
      "node_id": "ollama_generate",
      "input_key": "num_ctx",
      "label": "コンテキスト長",
      "value_type": "integer",
      "group": "Ollamaの設定"
    }
  ],
  "fixed": []
};
