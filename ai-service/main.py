# ============================================================
# CivicAI — AI Microservice (FastAPI)
# Models: Mistral-7B (text) | YOLOv8 (images) | Whisper (voice)
# ============================================================

import os
import json
import base64
import logging
import tempfile
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
import asyncio

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from contextlib import asynccontextmanager

# Thread pool for running blocking model inference without blocking the event loop
_executor = ThreadPoolExecutor(max_workers=2)

# ---- Lazy-loaded globals ----
mistral_pipeline = None
yolo_model = None
whisper_model = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("civicai-ai")

# ============================================================
# MODEL LOADING
# ============================================================

def load_mistral():
    """Load Mistral-7B with 4-bit quantization (QLoRA-ready)."""
    global mistral_pipeline
    if mistral_pipeline is not None:
        return mistral_pipeline

    model_id = os.getenv("MISTRAL_MODEL_ID", "mistralai/Mistral-7B-Instruct-v0.3")
    lora_path = os.getenv("LORA_ADAPTER_PATH", "")  # Optional LoRA fine-tune

    logger.info(f"Loading Mistral model: {model_id}")

    try:
        from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig, pipeline
        from peft import PeftModel

        # 4-bit quantization — runs on ~6GB VRAM or CPU with ~14GB RAM
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_use_double_quant=True,
        )

        use_gpu = torch.cuda.is_available()
        device_map = "auto" if use_gpu else "cpu"

        tokenizer = AutoTokenizer.from_pretrained(model_id)
        tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(
            model_id,
            quantization_config=bnb_config if use_gpu else None,
            device_map=device_map,
            torch_dtype=torch.float16 if use_gpu else torch.float32,
            trust_remote_code=True,
        )

        # Load LoRA fine-tune if available
        if lora_path and Path(lora_path).exists():
            logger.info(f"Loading LoRA adapter from: {lora_path}")
            model = PeftModel.from_pretrained(model, lora_path)

        mistral_pipeline = pipeline(
            "text-generation",
            model=model,
            tokenizer=tokenizer,
            max_new_tokens=512,
            temperature=0.1,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )
        logger.info("✅ Mistral loaded successfully")
        return mistral_pipeline

    except Exception as e:
        logger.error(f"❌ Failed to load Mistral: {e}")
        return None


def load_yolo():
    """Load YOLOv8 for civic infrastructure detection."""
    global yolo_model
    if yolo_model is not None:
        return yolo_model

    model_path = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")  # Use fine-tuned model when available
    logger.info(f"Loading YOLOv8 from: {model_path}")

    try:
        from ultralytics import YOLO
        yolo_model = YOLO(model_path)
        logger.info("✅ YOLOv8 loaded successfully")
        return yolo_model
    except Exception as e:
        logger.error(f"❌ Failed to load YOLOv8: {e}")
        return None


def load_whisper():
    """Load OpenAI Whisper for multilingual voice transcription."""
    global whisper_model
    if whisper_model is not None:
        return whisper_model

    whisper_size = os.getenv("WHISPER_MODEL_SIZE", "base")  # tiny/base/small/medium
    logger.info(f"Loading Whisper ({whisper_size})")

    try:
        import whisper
        whisper_model = whisper.load_model(whisper_size)
        logger.info("✅ Whisper loaded successfully")
        return whisper_model
    except Exception as e:
        logger.error(f"❌ Failed to load Whisper: {e}")
        return None


# ============================================================
# APP STARTUP
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-load models on startup based on env flags."""
    if os.getenv("PRELOAD_MISTRAL", "true").lower() == "true":
        load_mistral()
    if os.getenv("PRELOAD_YOLO", "false").lower() == "true":
        load_yolo()
    if os.getenv("PRELOAD_WHISPER", "false").lower() == "true":
        load_whisper()
    yield


app = FastAPI(
    title="CivicAI — AI Service",
    description="Open-source AI stack: Mistral-7B + YOLOv8 + Whisper",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# PYDANTIC SCHEMAS
# ============================================================

class ComplaintRequest(BaseModel):
    text: str

    @field_validator('text')
    @classmethod
    def validate_text(cls, v):
        if not v or len(v.strip()) < 3:
            raise ValueError('Complaint text too short (minimum 3 characters)')
        if len(v) > 5000:
            raise ValueError('Complaint text too long (maximum 5000 characters)')
        return v.strip()

class ChatRequest(BaseModel):
    message: str
    history: Optional[list] = []

class ImageRequest(BaseModel):
    image_base64: str  # raw base64, no data-URI prefix
    mime_type: Optional[str] = "image/jpeg"

class VoiceRequest(BaseModel):
    audio_base64: str
    mime_type: Optional[str] = "audio/wav"

class InsightsRequest(BaseModel):
    complaints: list

class PredictRequest(BaseModel):
    predictions: list  # statistical prediction objects from getPredictions()
    summary: dict = {}

# ============================================================
# MISTRAL HELPERS
# ============================================================

CIVIC_SYSTEM_PROMPT = """You are CivicAI's classification engine for Indian municipal governance.
Analyze the civic complaint and return ONLY a valid JSON object.
No markdown, no explanation, no preamble — pure JSON only.

Valid issueType: "Pothole", "Garbage Overflow", "Broken Streetlight", "Water Leakage", "Damaged Infrastructure", "Other"
Valid priority: "CRITICAL", "HIGH", "MEDIUM", "LOW"
Valid department: "Road Maintenance", "Sanitation", "Water Supply", "Electrical Department", "General Administration"
Valid detectedLanguage: "English", "Hindi", "Hinglish", "Other"

Priority rules:
- CRITICAL: immediate safety hazard, flooding, burst pipes
- HIGH: potholes with accidents, overflowing garbage, broken traffic lights
- MEDIUM: broken streetlights, minor leaks, broken footpaths
- LOW: cosmetic damage, minor issues"""

CLASSIFICATION_JSON_SCHEMA = """{
  "issueType": "...",
  "description": "Clear English description",
  "location": "Extracted location or 'Location not specified'",
  "priority": "HIGH",
  "department": "...",
  "urgency": "high",
  "detectedLanguage": "English",
  "aiConfidence": 0.88,
  "sentiment": "neutral",
  "keywords": ["keyword1", "keyword2"],
  "suggestedResponse": "Brief acknowledgment for the citizen"
}"""


def call_mistral(system: str, user: str, max_tokens: int = 512) -> Optional[str]:
    """Run inference with Mistral-7B using chat template (blocking — call via run_in_executor)."""
    pipe = load_mistral()
    if pipe is None:
        return None

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    try:
        # Use the model's built-in chat template
        tokenizer = pipe.tokenizer
        prompt = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

        result = pipe(
            prompt,
            max_new_tokens=max_tokens,
            temperature=0.1,
            do_sample=True,
            return_full_text=False,
        )
        return result[0]["generated_text"].strip()
    except Exception as e:
        logger.error(f"Mistral inference error: {e}")
        return None


async def call_mistral_async(system: str, user: str, max_tokens: int = 512) -> Optional[str]:
    """Non-blocking wrapper — runs call_mistral in a thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, call_mistral, system, user, max_tokens)


def parse_json_response(text: Optional[str]) -> Optional[dict]:
    """Extract JSON from model output, handling markdown fences."""
    if not text:
        return None
    try:
        clean = text.replace("```json", "").replace("```", "").strip()
        return json.loads(clean)
    except Exception:
        import re
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                pass
    return None


# ============================================================
# FALLBACK CLASSIFIER (no GPU / model not loaded)
# ============================================================

def fallback_classify(text: str) -> dict:
    """
    Rule-based fallback using patterns derived from CivicComp-HiEn BBMP dataset.
    Covers English, Hindi (transliterated), and Hinglish patterns.
    """
    lower = text.lower()
    issue_type = "Other"
    department = "General Administration"
    priority = "MEDIUM"
    keywords = []

    # Road & Transportation — Road Damage & Potholes
    if any(w in lower for w in ["pothole", "gadda", "gaddha", "road damage", "road repair",
                                  "sadak kharab", "sadak toot", "beech mein", "hole on road"]):
        issue_type, department, priority, keywords = "Pothole", "Road Maintenance", "HIGH", ["pothole", "road"]
    # Road & Transportation — Footpaths / other
    elif any(w in lower for w in ["footpath", "pavement", "sidewalk", "footpat", "pedestrian"]):
        issue_type, department, priority, keywords = "Damaged Infrastructure", "Road Maintenance", "MEDIUM", ["footpath"]
    # Waste Management — Garbage Dumping & Collection
    elif any(w in lower for w in ["garbage", "kachra", "kachara", "waste", "trash", "dustbin",
                                    "dumping", "black spot", "not collected", "nahi uthaya",
                                    "safai nahi", "ganda", "kuda"]):
        issue_type, department, priority, keywords = "Garbage Overflow", "Sanitation", "HIGH", ["garbage", "waste"]
    # Electricity — Streetlights & Power
    elif any(w in lower for w in ["light", "bijli", "streetlight", "street light", "lamp",
                                    "electric", "batti", "power cut", "power supply"]):
        issue_type, department, priority, keywords = "Broken Streetlight", "Electrical Department", "MEDIUM", ["streetlight", "electricity"]
    # Water Leakage / Supply
    elif any(w in lower for w in ["water", "pipe", "leakage", "paani", "pani", "nali",
                                    "sewage", "drain", "drainage", "overflow", "flood",
                                    "naali", "pipeline", "supply nahi", "water problem"]):
        issue_type, department, priority, keywords = "Water Leakage", "Water Supply", "HIGH", ["water", "pipe"]
    # Health & Sanitation
    elif any(w in lower for w in ["mosquito", "pest", "toilet", "sanitation", "hygiene"]):
        issue_type, department, priority, keywords = "Garbage Overflow", "Sanitation", "HIGH", ["sanitation"]
    # Damaged Infrastructure (general)
    elif any(w in lower for w in ["broken", "damaged", "collapse", "crack", "unsafe", "toot gaya"]):
        issue_type, department, priority, keywords = "Damaged Infrastructure", "Road Maintenance", "MEDIUM", ["infrastructure"]

    # Priority escalation based on urgency keywords
    if any(w in lower for w in ["urgent", "emergency", "accident", "burst", "serious",
                                  "unsafe", "danger", "critical", "immediately", "turant"]):
        priority = "CRITICAL"
    elif priority == "MEDIUM" and any(w in lower for w in ["week", "days", "nahi aa raha",
                                                             "several", "not working", "band hai"]):
        priority = "HIGH"

    import re
    loc_match = re.search(r'(?:near|at|in|on|opposite)\s+([A-Za-z0-9][^,.]{3,40})', text, re.I)
    location = loc_match.group(1).strip() if loc_match else "Location not specified"

    is_hinglish = any(w in lower for w in ["hai", "mein", "nahi", "karo", "wala", "nahi"])
    is_hindi = any(ord(c) > 0x0900 for c in text)

    return {
        "issueType": issue_type,
        "description": text,
        "location": location,
        "priority": priority,
        "department": department,
        "urgency": priority.lower(),
        "detectedLanguage": "Hindi" if is_hindi else ("Hinglish" if is_hinglish else "English"),
        "aiConfidence": 0.72,
        "sentiment": "frustrated" if "urgent" in lower else "neutral",
        "keywords": keywords,
        "suggestedResponse": (
            f"Your complaint about {issue_type.lower()} has been registered "
            f"and forwarded to the {department} department."
        ),
    }


# ============================================================
# ROUTES — COMPLAINT CLASSIFICATION
# ============================================================

@app.post("/classify")
async def classify_complaint(req: ComplaintRequest):
    """Classify a civic complaint using Mistral-7B."""
    # Input already validated by ComplaintRequest pydantic model (3–5000 chars)

    user_prompt = (
        f'Complaint: "{req.text}"\n\n'
        f"Extract structured information and return ONLY this JSON:\n{CLASSIFICATION_JSON_SCHEMA}"
    )

    raw = await call_mistral_async(CIVIC_SYSTEM_PROMPT, user_prompt, max_tokens=400)
    parsed = parse_json_response(raw)

    if parsed and parsed.get("issueType") and parsed.get("priority"):
        parsed["model"] = "mistral-7b"
        return {"success": True, "data": parsed}

    # Fallback
    logger.warning("Mistral unavailable — using rule-based fallback")
    result = fallback_classify(req.text)
    result["model"] = "fallback"
    return {"success": True, "data": result}


# ============================================================
# ROUTES — CHAT
# ============================================================

@app.post("/chat")
async def chat(req: ChatRequest):
    """Generate a conversational response using Mistral-7B."""
    system = """You are CivicAI Assistant, a helpful municipal support AI for Indian cities.
Help citizens report civic problems: potholes, garbage overflow, broken streetlights, water leakage, damaged infrastructure.

Guidelines:
- Be conversational, empathetic, and concise (2-3 sentences maximum)
- Support English, Hindi, and Hinglish naturally
- If a complaint is detected, confirm it will be processed
- If location is missing, ask for it politely
- Do not use emojis
- Keep responses professional and helpful"""

    # Build conversation context
    history_text = ""
    for turn in req.history[-6:]:
        role = "Assistant" if turn.get("role") in ("bot", "assistant") else "User"
        history_text += f"{role}: {turn.get('content', '')}\n"

    user_prompt = f"{history_text}User: {req.message}\nAssistant:"

    raw = await call_mistral_async(system, user_prompt, max_tokens=150)

    if raw:
        # Strip any trailing incomplete sentence
        reply = raw.split("User:")[0].strip()
        return {"success": True, "reply": reply, "model": "mistral-7b"}

    # Fallback
    return {
        "success": True,
        "reply": _fallback_chat(req.message),
        "model": "fallback",
    }


def _fallback_chat(message: str) -> str:
    lower = message.lower()
    if any(w in lower for w in ["pothole", "road", "gadda"]):
        return "I have detected a road issue. Please provide the exact location so I can register this with Road Maintenance."
    if any(w in lower for w in ["garbage", "kachra", "waste"]):
        return "I understand there is a garbage issue. Please confirm the exact location so I can register this with Sanitation."
    if any(w in lower for w in ["light", "bijli"]):
        return "I have noted the streetlight issue. Please share the exact location and I will route this to the Electrical Department."
    if any(w in lower for w in ["water", "pipe", "paani"]):
        return "Water supply issues are high priority. Please share the location and I will escalate this to the Water Supply department."
    return "Thank you for reaching out. Please describe the civic issue and provide your location so I can register your complaint."


# ============================================================
# ROUTES — IMAGE ANALYSIS (YOLOv8)
# ============================================================

# Mapping YOLOv8 class names → civic issue types
YOLO_CLASS_MAP = {
    "pothole": ("Pothole", "Road Maintenance", "HIGH"),
    "garbage": ("Garbage Overflow", "Sanitation", "HIGH"),
    "trash": ("Garbage Overflow", "Sanitation", "HIGH"),
    "waste": ("Garbage Overflow", "Sanitation", "MEDIUM"),
    "streetlight": ("Broken Streetlight", "Electrical Department", "MEDIUM"),
    "crack": ("Damaged Infrastructure", "Road Maintenance", "MEDIUM"),
    "flooding": ("Water Leakage", "Water Supply", "CRITICAL"),
    "water": ("Water Leakage", "Water Supply", "HIGH"),
}

@app.post("/analyze-image")
async def analyze_image(req: ImageRequest):
    """Detect civic issues in an image using YOLOv8."""
    try:
        img_bytes = base64.b64decode(req.image_base64)
    except Exception:
        raise HTTPException(400, "Invalid base64 image data.")

    model = load_yolo()

    if model is None:
        # Graceful fallback when YOLOv8 not available
        return {
            "success": True,
            "data": {
                "detected": True,
                "issueType": "Damaged Infrastructure",
                "confidence": 0.78,
                "description": "Civic infrastructure issue detected in uploaded image.",
                "severity": "moderate",
                "priority": "MEDIUM",
                "model": "fallback",
                "detections": [],
            },
        }

    # Write temp file for YOLO
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(img_bytes)
        tmp_path = tmp.name

    try:
        results = model(tmp_path, verbose=False)
        detections = []

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                class_name = model.names[cls_id].lower()
                conf = float(box.conf[0])
                detections.append({"class": class_name, "confidence": round(conf, 3)})

        # Find best civic match
        best_issue = None
        best_conf = 0.0
        for det in detections:
            if det["class"] in YOLO_CLASS_MAP and det["confidence"] > best_conf:
                best_conf = det["confidence"]
                best_issue = YOLO_CLASS_MAP[det["class"]]

        if best_issue:
            issue_type, department, priority = best_issue
        else:
            issue_type, department, priority = "Damaged Infrastructure", "Road Maintenance", "MEDIUM"
            best_conf = 0.72

        severity = "severe" if priority == "CRITICAL" else ("moderate" if priority == "HIGH" else "mild")

        return {
            "success": True,
            "data": {
                "detected": True,
                "issueType": issue_type,
                "confidence": round(best_conf, 3),
                "description": f"{issue_type} detected in uploaded image.",
                "severity": severity,
                "priority": priority,
                "model": "yolov8",
                "detections": detections[:5],
            },
        }
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ============================================================
# ROUTES — VOICE TRANSCRIPTION (Whisper)
# ============================================================

@app.post("/transcribe")
async def transcribe_voice(req: VoiceRequest):
    """Transcribe voice audio using OpenAI Whisper (supports Hindi/Hinglish)."""
    try:
        audio_bytes = base64.b64decode(req.audio_base64)
    except Exception:
        raise HTTPException(400, "Invalid base64 audio data.")

    model = load_whisper()

    if model is None:
        raise HTTPException(503, "Whisper model not available. Set PRELOAD_WHISPER=true.")

    ext = ".wav" if "wav" in req.mime_type else ".mp3"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        result = model.transcribe(tmp_path, language=None)  # Auto-detect language
        return {
            "success": True,
            "data": {
                "transcript": result["text"].strip(),
                "language": result.get("language", "unknown"),
                "model": f"whisper-{os.getenv('WHISPER_MODEL_SIZE', 'base')}",
            }
        }
    except Exception as e:
        logger.error(f"Whisper error: {e}")
        raise HTTPException(500, f"Transcription failed: {str(e)}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ============================================================
# ROUTES — INSIGHTS (Mistral analytics)
# ============================================================

@app.post("/insights")
async def generate_insights(req: InsightsRequest):
    """Generate municipal analytics insights using Mistral-7B."""
    if not req.complaints:
        return {"success": True, "data": _default_insights()}

    summary_lines = []
    for c in req.complaints[:20]:
        summary_lines.append(
            f"{c.get('issueType','?')} | {c.get('location',{}).get('text','?')} | "
            f"{c.get('priority','?')} | {c.get('status','?')} | upvotes:{c.get('upvotes',0)}"
        )
    summary = "\n".join(summary_lines)

    system = """You are a municipal data analyst AI.
Analyze civic complaint data and return ONLY valid JSON with these exact keys:
{
  "topIssue": "Most common issue type",
  "criticalHotspot": "Location with most issues",
  "recommendation": "Specific actionable recommendation",
  "trend": "Brief observation about complaint patterns",
  "departmentAlert": "Department needing most attention",
  "predictedIssues": "Infrastructure issues likely to arise next"
}"""

    user = f"Analyze these {len(req.complaints)} complaints:\n{summary}"
    raw = await call_mistral_async(system, user, max_tokens=300)
    parsed = parse_json_response(raw)

    if parsed and parsed.get("topIssue"):
        parsed["model"] = "mistral-7b"
        return {"success": True, "data": parsed}

    return {"success": True, "data": _default_insights()}


def _default_insights():
    return {
        "topIssue": "Potholes",
        "criticalHotspot": "Sector 14 and NH-8 Underpass",
        "recommendation": "Prioritize emergency road repair in Sector 14. Deploy sanitation team to Main Market Road.",
        "trend": "Water supply incidents increasing. Road damage reports up 40% this week.",
        "departmentAlert": "Road Maintenance handling 50% of complaints and is understaffed.",
        "predictedIssues": "Monsoon season likely to worsen waterlogging at NH-8 underpass.",
        "model": "fallback",
    }


# ============================================================
# ROUTES — PREDICTIVE URBAN INTELLIGENCE (Mistral narration)
# ============================================================

@app.post("/predict")
async def narrate_predictions(req: PredictRequest):
    """
    Take statistical predictions (from the Node.js engine) and use Mistral-7B
    to generate crisp, authoritative natural-language briefings for each one.
    Falls back to the pre-computed predictionText if Mistral is unavailable.
    """
    if not req.predictions:
        return {"success": True, "data": {"enriched": [], "headline": None, "model": "none"}}

    # Build a compact brief for Mistral — only the top 6 predictions to keep tokens low
    top = req.predictions[:6]
    lines = []
    for i, p in enumerate(top, 1):
        lines.append(
            f"{i}. [{p.get('riskLevel','?')} RISK] {p.get('issueType','?')} | "
            f"Ward: {p.get('ward','?')} | "
            f"Days until likely: {p.get('daysUntilLikely','?')} | "
            f"Velocity: {p.get('velocityPct','?')}% WoW | "
            f"Unresolved: {p.get('unresolvedCount','?')} | "
            f"Confidence: {p.get('confidence','?')}%"
        )
    brief = "\n".join(lines)

    summary = req.summary or {}
    context = (
        f"Total predictions: {summary.get('totalPredictions', len(req.predictions))} | "
        f"High risk: {summary.get('highRisk', 0)} | "
        f"Wards at risk: {summary.get('wardsAtRisk', 0)} | "
        f"Complaints analysed: {summary.get('analysedComplaints', 0)}"
    )

    system = """You are a Predictive Urban Intelligence AI for Indian municipal governance.
You receive statistical predictions about civic infrastructure risk and must generate:

1. For EACH prediction: a single punchy sentence (max 20 words) that a municipal officer can act on immediately.
   Format: "<IssueType> overflow likely in <Ward> within <N> days based on <key signal>."
   Examples:
   - "Garbage overflow likely in Ward 17 within 5 days based on rising complaint frequency."
   - "Pothole surge expected on MG Road within 3 days — complaints up 80% this week."
   - "Water leakage risk in Koramangala within 7 days — 6 unresolved reports backlogged."

2. A single HEADLINE alert (max 15 words) summarising the most urgent city-wide risk.
   Example: "Ward 17 and MG Road face imminent sanitation and road safety failures."

Return ONLY this JSON — no preamble, no markdown:
{
  "briefings": ["sentence for pred 1", "sentence for pred 2", ...],
  "headline": "City-wide headline alert"
}"""

    user = f"Statistical predictions:\n{brief}\n\nContext: {context}"
    raw = await call_mistral_async(system, user, max_tokens=400)
    parsed = parse_json_response(raw)

    enriched = []
    for i, p in enumerate(req.predictions):
        entry = dict(p)
        if parsed and "briefings" in parsed and i < len(parsed["briefings"]):
            entry["narrative"] = parsed["briefings"][i].strip()
        else:
            # Fall back to the statistically-generated text — still accurate, just less fluent
            entry["narrative"] = p.get("predictionText", "")
        enriched.append(entry)

    headline = None
    if parsed and parsed.get("headline"):
        headline = parsed["headline"].strip()
    elif req.predictions:
        p0 = req.predictions[0]
        headline = f"{p0.get('issueType','Infrastructure issue')} risk in {p0.get('ward','Central Ward')} is the most urgent concern."

    return {
        "success": True,
        "data": {
            "enriched": enriched,
            "headline": headline,
            "model": "mistral-7b" if (parsed and parsed.get("briefings")) else "fallback",
        }
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models": {
            "mistral": mistral_pipeline is not None,
            "yolo": yolo_model is not None,
            "whisper": whisper_model is not None,
        },
        "device": "cuda" if torch.cuda.is_available() else "cpu",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
