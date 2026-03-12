"""
CivicAI — LoRA Fine-Tuning Script for Mistral-7B
=================================================
Uses the CivicComp-HiEn dataset (29,137 real BBMP civic complaints
in English, Hindi, and Hinglish) to teach Mistral-7B to return
structured JSON for CivicAI complaint classification.

Fine-tuning method: QLoRA (4-bit quantization + LoRA adapters)
Benefits vs full fine-tuning:
  - Trains in ~1–2 hours on a single GPU (vs days)
  - Requires ~8GB VRAM (vs 80GB+)
  - Adapter file is ~50MB (vs 14GB full model)

Usage:
    # Full dataset (recommended)
    python training/finetune_lora.py \\
        --dataset_path training/civic_complaints_dataset.jsonl \\
        --output_dir ./lora-civicai \\
        --epochs 3

    # Quick test with 500 examples
    python training/finetune_lora.py \\
        --dataset_path training/civic_complaints_starter_500.jsonl \\
        --output_dir ./lora-civicai-test \\
        --epochs 1

Output: ./lora-civicai/
Set LORA_ADAPTER_PATH=./lora-civicai in your .env
"""

import argparse
import json
import os
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig, get_peft_model, TaskType
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from trl import SFTTrainer

# ============================================================
# PROMPT BUILDER
# ============================================================

SYSTEM_PROMPT = (
    "You are CivicAI's complaint classification engine for Indian municipal governance. "
    "Analyze the civic complaint and return ONLY valid JSON. "
    "No markdown, no explanation, no preamble — pure JSON only. "
    "Valid issueType: Pothole, Garbage Overflow, Broken Streetlight, Water Leakage, Damaged Infrastructure, Other. "
    "Valid priority: CRITICAL, HIGH, MEDIUM, LOW. "
    "Valid department: Road Maintenance, Sanitation, Water Supply, Electrical Department, General Administration."
)

def build_prompt(instruction: str, output: str, tokenizer) -> str:
    """Format a training example using the Mistral chat template."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": instruction},
        {"role": "assistant", "content": output},
    ]
    return tokenizer.apply_chat_template(messages, tokenize=False)


def load_jsonl(path: str) -> list:
    data = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                data.append(json.loads(line))
    return data


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_id", default="mistralai/Mistral-7B-Instruct-v0.3")
    parser.add_argument("--dataset_path", default="training/civic_complaints_dataset.jsonl",
                        help="Path to .jsonl file (instruction/output pairs)")
    parser.add_argument("--output_dir", default="./lora-civicai")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=2,
                        help="Per-device batch size. Use 1 if OOM, 4 if >16GB VRAM.")
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--lora_r", type=int, default=16,
                        help="LoRA rank. Higher = more expressive but larger adapter.")
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--max_samples", type=int, default=0,
                        help="Limit training examples (0 = use all). Use 2000 for quick test.")
    args = parser.parse_args()

    # ---- Tokenizer ----
    print(f"Loading tokenizer: {args.model_id}")
    tokenizer = AutoTokenizer.from_pretrained(args.model_id)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # ---- Dataset ----
    print(f"Loading dataset: {args.dataset_path}")
    raw_data = load_jsonl(args.dataset_path)

    if args.max_samples > 0:
        import random; random.seed(42); random.shuffle(raw_data)
        raw_data = raw_data[:args.max_samples]

    print(f"Training on {len(raw_data)} examples")

    # Language distribution
    from collections import Counter
    langs = Counter(json.loads(d["output"]).get("detectedLanguage","?") for d in raw_data)
    print(f"Language split: {dict(langs)}")

    texts = [build_prompt(d["instruction"], d["output"], tokenizer) for d in raw_data]
    dataset = Dataset.from_dict({"text": texts})

    # ---- Model ----
    use_gpu = torch.cuda.is_available()
    print(f"Device: {'CUDA GPU — using 4-bit QLoRA' if use_gpu else 'CPU — using fp32 (slow)'}")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    ) if use_gpu else None

    model = AutoModelForCausalLM.from_pretrained(
        args.model_id,
        quantization_config=bnb_config,
        device_map="auto" if use_gpu else "cpu",
        torch_dtype=torch.float16 if use_gpu else torch.float32,
        trust_remote_code=True,
    )
    model.config.use_cache = False

    # ---- LoRA ----
    # Target all projection layers for best classification accuracy
    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    # Expected: ~0.6% trainable params (~42M / 7B)

    # ---- Training ----
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,   # Effective batch = batch_size * 4
        learning_rate=args.lr,
        fp16=use_gpu,
        logging_steps=50,
        save_strategy="epoch",
        save_total_limit=2,
        optim="paged_adamw_8bit" if use_gpu else "adamw_torch",
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
        report_to="none",
        dataloader_pin_memory=use_gpu,
    )

    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        args=training_args,
        tokenizer=tokenizer,
        dataset_text_field="text",
        max_seq_length=1024,
        packing=True,   # Pack multiple short examples into one context window = faster training
    )

    print(f"\n🚀 Starting LoRA fine-tuning on {len(dataset)} examples...")
    print(f"   Estimated time: {'~1–2 hrs (GPU)' if use_gpu else '~8–24 hrs (CPU)'}")
    trainer.train()

    # ---- Save ----
    output_path = Path(args.output_dir)
    model.save_pretrained(output_path)
    tokenizer.save_pretrained(output_path)

    # Write a manifest so the AI service knows what this adapter was trained on
    manifest = {
        "base_model": args.model_id,
        "training_examples": len(raw_data),
        "language_split": dict(langs),
        "epochs": args.epochs,
        "lora_r": args.lora_r,
        "dataset": str(args.dataset_path),
        "civicai_version": "1.0"
    }
    with open(output_path / "adapter_manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    adapter_size_mb = sum(
        p.stat().st_size for p in output_path.rglob("*.bin")
    ) / 1e6
    print(f"\n✅ LoRA adapter saved to: {output_path}")
    print(f"   Adapter size: ~{adapter_size_mb:.0f}MB (vs ~14GB for full model)")
    print(f"   Trained on: {len(raw_data)} CivicComp-HiEn examples")
    print(f"\nNext steps:")
    print(f"  1. Set LORA_ADAPTER_PATH={output_path} in .env")
    print(f"  2. Restart: docker-compose up --build ai-service")
