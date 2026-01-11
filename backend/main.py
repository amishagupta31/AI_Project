import pandas as pd
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Body
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import io
import os
import json
import hashlib
import re
from typing import List, Dict, Any, Optional
from datetime import datetime
from contextlib import asynccontextmanager

from data_processor import process_dataset, get_correlation_matrix, get_column_stats, generate_pdf_report

# --- Configuration ---
UPLOAD_DIR = "uploaded_files"
CLEANED_DIR = "cleaned_files"
HASH_DB_FILE = "cleaned_file_hashes.json"

# --- Helper: Hash Functions ---
def load_known_hashes():
    if os.path.exists(HASH_DB_FILE):
        try:
            with open(HASH_DB_FILE, "r") as f: return set(json.load(f))
        except: return set()
    return set()

def save_new_hash(file_hash):
    hashes = load_known_hashes()
    hashes.add(file_hash)
    with open(HASH_DB_FILE, "w") as f: json.dump(list(hashes), f)

def calculate_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

def interpret_natural_language(query: str, columns: List[str]) -> str:
    query = query.lower()
    target_col = None
    columns_sorted = sorted(columns, key=len, reverse=True)
    for col in columns_sorted:
        if col.lower() in query:
            target_col = col
            break
    if not target_col: return ""
    operator = "="
    if any(w in query for w in ["greater", "more", "above", "over", "higher", ">"]): operator = ">"
    elif any(w in query for w in ["less", "lower", "under", "below", "<"]): operator = "<"
    elif any(w in query for w in ["equal", "is", "match", "same", "="]): operator = "="
    numbers = re.findall(r"[-+]?\d*\.\d+|\d+", query)
    value = numbers[-1] if numbers else (query.split()[-1] if len(query.split()) > 1 else None)
    if not value: return ""
    return f"{target_col} {operator} {value}"

@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(CLEANED_DIR, exist_ok=True)
    print("InfoPulse AI Backend is running...")
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.get("/")
def health_check():
    return {
        "status": "ok",
        "service": "InfoPulse AI Backend"
    }
class Insights(BaseModel):
    request_id: str
    rows_original: int
    rows_cleaned: int
    anomalies_detected: int
    duplicates_removed: int
    pii_masked: int
    quality_score: float
    summary: str
    logs: List[str]
    numeric_columns: List[str]
    generated_sql: str
    column_stats: List[Dict[str, Any]]
    correlation_matrix: List[Dict[str, Any]]

class DataResponse(BaseModel):
    request_id: str
    insights: Insights
    preview_original: List[Dict[str, Any]]
    preview_cleaned: List[Dict[str, Any]]

class AskRequest(BaseModel):
    query: str
    columns: List[str]

class AskResponse(BaseModel):
    filter_string: str
    explanation: str

# --- Endpoints ---

@app.post("/upload", response_model=DataResponse)
async def upload_file(file: UploadFile = File(...), mask_pii: bool = Form(True)):
    request_id = datetime.now().strftime("%Y%m%d%H%M%S") + "_" + str(np.random.randint(1000, 9999))
    
    try: file_content = await file.read()
    except Exception as e: raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")

    incoming_hash = calculate_hash(file_content)
    known_hashes = load_known_hashes()
    is_already_clean = incoming_hash in known_hashes

    if is_already_clean:
        print(f"File {file.filename} identified as already clean.")
        try:
            if file.filename.endswith('.csv'): df = pd.read_csv(io.BytesIO(file_content))
            else: df = pd.read_excel(io.BytesIO(file_content))
        except: df = pd.read_csv(io.BytesIO(file_content), encoding='latin1')

        rows_count = len(df)
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        preview = df.head(50).replace({np.nan: None}).to_dict(orient='records')
        
        insights = Insights(
            request_id=request_id,
            rows_original=rows_count,
            rows_cleaned=rows_count,
            anomalies_detected=0,
            duplicates_removed=0,
            pii_masked=0,
            quality_score=100.0,
            summary="✨ This file has already been processed by InfoPulse AI. No further cleaning was required.",
            logs=["File fingerprint matched known clean dataset.", "Skipped anomaly detection pipeline.", "Data loaded directly for visualization."],
            numeric_columns=numeric_cols,
            generated_sql="-- File was already clean; no transformation SQL generated.",
            column_stats=get_column_stats(df),
            correlation_matrix=get_correlation_matrix(df)
        )
        
        with open(os.path.join(CLEANED_DIR, f"{request_id}_insights.json"), "w") as f:
            f.write(insights.json())

        uploaded_filepath = os.path.join(UPLOAD_DIR, f"{request_id}{os.path.splitext(file.filename)[1]}")
        cleaned_filepath = os.path.join(CLEANED_DIR, f"{request_id}_cleaned.csv")
        with open(uploaded_filepath, "wb") as f: f.write(file_content)
        df.to_csv(cleaned_filepath, index=False)
        
        return DataResponse(request_id=request_id, insights=insights, preview_original=preview, preview_cleaned=preview)

    # Normal Processing
    file_extension = os.path.splitext(file.filename)[1].lower()
    uploaded_filepath = os.path.join(UPLOAD_DIR, f"{request_id}{file_extension}")
    try:
        with open(uploaded_filepath, "wb") as buffer: buffer.write(file_content)
        df_cleaned, insights_dict, preview_original, preview_cleaned = process_dataset(file_content, file.filename, mask_pii)
        
        cleaned_csv_str = df_cleaned.to_csv(index=False)
        cleaned_hash = calculate_hash(cleaned_csv_str.encode('utf-8'))
        save_new_hash(cleaned_hash)
        
        insights = Insights(request_id=request_id, **insights_dict)
        
        with open(os.path.join(CLEANED_DIR, f"{request_id}_insights.json"), "w") as f:
            f.write(insights.json())

    except ValueError as e:
        if os.path.exists(uploaded_filepath): os.remove(uploaded_filepath)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        if os.path.exists(uploaded_filepath): os.remove(uploaded_filepath)
        raise HTTPException(status_code=500, detail=f"Server Error: {e}")

    cleaned_filepath = os.path.join(CLEANED_DIR, f"{request_id}_cleaned.csv")
    df_cleaned.to_csv(cleaned_filepath, index=False)

    return DataResponse(request_id=request_id, insights=insights, preview_original=preview_original, preview_cleaned=preview_cleaned)

@app.post("/ask", response_model=AskResponse)
async def ask_ai(request: AskRequest):
    try:
        filter_str = interpret_natural_language(request.query, request.columns)
        if not filter_str: return AskResponse(filter_string="", explanation="I couldn't quite understand that. Try 'Age > 30'.")
        return AskResponse(filter_string=filter_str, explanation=f"Applying filter: {filter_str}")
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.get("/download/{request_id}")
async def download_file(request_id: str, format: str = "csv"):
    cleaned_filepath = os.path.join(CLEANED_DIR, f"{request_id}_cleaned.csv")
    if not os.path.exists(cleaned_filepath): raise HTTPException(status_code=404, detail="Cleaned file not found.")
    
    if format == "csv":
        return FileResponse(path=cleaned_filepath, filename=f"InfoPulse_{request_id}.csv", media_type='text/csv')
    
    if format == "pdf":
        insights_path = os.path.join(CLEANED_DIR, f"{request_id}_insights.json")
        pdf_path = os.path.join(CLEANED_DIR, f"{request_id}_report.pdf")
        
        if not os.path.exists(insights_path):
             raise HTTPException(status_code=404, detail="Insights data for report not found.")
             
        if not os.path.exists(pdf_path):
            with open(insights_path, 'r') as f: insights = json.load(f)
            df = pd.read_csv(cleaned_filepath)
            generate_pdf_report(df, insights, pdf_path)
            
        return FileResponse(path=pdf_path, filename=f"InfoPulse_Report_{request_id}.pdf", media_type='application/pdf')

    df = pd.read_csv(cleaned_filepath)

    if format == "json":
        json_str = df.to_json(orient="records", indent=2)
        return StreamingResponse(io.StringIO(json_str), media_type="application/json", headers={"Content-Disposition": f"attachment; filename=InfoPulse_{request_id}.json"})

    elif format == "sql":
        table_name = "cleaned_data"
        sql_buffer = io.StringIO()
        sql_buffer.write(f"CREATE TABLE {table_name} (\n")
        cols = []
        for col, dtype in df.dtypes.items():
            col_name = str(col).replace(' ', '_').replace('-', '_')
            sql_type = "TEXT"
            if pd.api.types.is_integer_dtype(dtype): sql_type = "INT"
            elif pd.api.types.is_float_dtype(dtype): sql_type = "FLOAT"
            cols.append(f"    {col_name} {sql_type}")
        sql_buffer.write(",\n".join(cols))
        sql_buffer.write("\n);\n\n")
        for _, row in df.iterrows():
            vals = []
            for v in row:
                if pd.isna(v): 
                    vals.append("NULL")
                elif isinstance(v, str): 
                    # Fixed quote escaping issue
                    safe_v = str(v).replace("'", "''")
                    vals.append(f"'{safe_v}'")
                else: 
                    vals.append(str(v))
            sql_buffer.write(f"INSERT INTO {table_name} VALUES ({', '.join(vals)});\n")
        sql_buffer.seek(0)
        return StreamingResponse(sql_buffer, media_type="text/plain", headers={"Content-Disposition": f"attachment; filename=InfoPulse_{request_id}.sql"})
        
    else: raise HTTPException(status_code=400, detail="Invalid format specified.")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
