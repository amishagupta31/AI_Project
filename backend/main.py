import pandas as pd
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import io
import os
import shutil
from typing import List, Dict, Any
from datetime import datetime
from contextlib import asynccontextmanager
from data_processor import process_dataset

# --- Configuration ---
UPLOAD_DIR = "uploaded_files"
CLEANED_DIR = "cleaned_files"

@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(CLEANED_DIR, exist_ok=True)
    print("InfoPulse AI Backend is running.")
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Data Structures ---
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
    correlation_matrix: List[Dict[str, Any]] # NEW: Field for Heatmap data

class DataResponse(BaseModel):
    request_id: str
    insights: Insights
    preview_original: List[Dict[str, Any]]
    preview_cleaned: List[Dict[str, Any]]

# --- Endpoints ---

@app.post("/upload", response_model=DataResponse)
async def upload_file(
    file: UploadFile = File(...), 
    mask_pii: bool = Form(True)
):
    request_id = datetime.now().strftime("%Y%m%d%H%M%S") + "_" + str(np.random.randint(1000, 9999))
    
    try:
        file_content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")

    file_extension = os.path.splitext(file.filename)[1].lower()
    uploaded_filepath = os.path.join(UPLOAD_DIR, f"{request_id}{file_extension}")
    
    try:
        with open(uploaded_filepath, "wb") as buffer:
            buffer.write(file_content)

        # Process Data
        df_cleaned, insights_dict, preview_original, preview_cleaned = process_dataset(
            file_content, 
            file.filename, 
            mask_pii
        )
        
        insights = Insights(request_id=request_id, **insights_dict)
    
    except ValueError as e:
        if os.path.exists(uploaded_filepath): os.remove(uploaded_filepath)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Processing Error: {e}")
        if os.path.exists(uploaded_filepath): os.remove(uploaded_filepath)
        raise HTTPException(status_code=500, detail=f"Server Error: {e}")

    cleaned_filepath = os.path.join(CLEANED_DIR, f"{request_id}_cleaned.csv")
    df_cleaned.to_csv(cleaned_filepath, index=False)

    return DataResponse(
        request_id=request_id,
        insights=insights,
        preview_original=preview_original,
        preview_cleaned=preview_cleaned
    )

@app.get("/download/{request_id}")
async def download_file(request_id: str, format: str = "csv"):
    cleaned_filepath = os.path.join(CLEANED_DIR, f"{request_id}_cleaned.csv")
    
    if not os.path.exists(cleaned_filepath):
        raise HTTPException(status_code=404, detail="Cleaned file not found.")
    
    # CSV Download
    if format == "csv":
        return FileResponse(
            path=cleaned_filepath,
            filename=f"InfoPulse_{request_id}.csv",
            media_type='text/csv'
        )

    # Load data for other formats
    df = pd.read_csv(cleaned_filepath)

    if format == "json":
        json_str = df.to_json(orient="records", indent=2)
        return StreamingResponse(
            io.StringIO(json_str),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=InfoPulse_{request_id}.json"}
        )

    elif format == "sql":
        table_name = "cleaned_data"
        sql_buffer = io.StringIO()
        
        # Create Table
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
        
        # Insert Data
        for _, row in df.iterrows():
            vals = []
            for v in row:
                if pd.isna(v): 
                    vals.append("NULL")
                elif isinstance(v, str): 
                    clean_v = str(v).replace("'", "''") 
                    vals.append(f"'{clean_v}'")
                else: 
                    vals.append(str(v))
            
            sql_buffer.write(f"INSERT INTO {table_name} VALUES ({', '.join(vals)});\n")
            
        sql_buffer.seek(0)
        return StreamingResponse(
            sql_buffer,
            media_type="text/plain",
            headers={"Content-Disposition": f"attachment; filename=InfoPulse_{request_id}.sql"}
        )
        
    else:
        raise HTTPException(status_code=400, detail="Invalid format specified.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)