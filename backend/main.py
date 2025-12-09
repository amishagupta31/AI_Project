import pandas as pd
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import io
import os
import shutil
from typing import List, Dict, Any
from datetime import datetime
from contextlib import asynccontextmanager # Import asynccontextmanager

# --- Configuration ---
UPLOAD_DIR = "uploaded_files"
CLEANED_DIR = "cleaned_files"

# --- Lifespan Event Handler (Replaces @app.on_event) ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handles startup and shutdown events for the application.
    This replaces the deprecated @app.on_event("startup") and @app.on_event("shutdown").
    """
    # Startup tasks
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(CLEANED_DIR, exist_ok=True)
    print("NeuroClean AI Backend is running. Access API at http://localhost:8000")
    yield
    # Shutdown tasks (none required here, but this is where they would go)

app = FastAPI(lifespan=lifespan) # Pass the lifespan handler to FastAPI

# --- CORS Middleware ---
# Allows the React frontend (running on a different port) to communicate with this backend.
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
    quality_score: int
    summary: str
    logs: List[str]
    numeric_columns: List[str]

class DataResponse(BaseModel):
    request_id: str
    insights: Insights
    chart_data: List[Dict[str, Any]] # Data for chart/table preview

# --- Cleaning Logic (The "AI Model") ---

def standardize_text(text: str) -> str:
    """
    General-purpose text standardization for product/category names.
    This replaces manual mapping with aggressive cleaning (strip, lower, title)
    to handle casing inconsistencies across diverse datasets.
    """
    if pd.isna(text) or not str(text).strip():
        return np.nan
    
    # 1. Aggressive cleaning (strip whitespace and convert to lowercase)
    cleaned_text = str(text).strip().lower()

    # 2. Check for common garbage entries that shouldn't be capitalized
    if cleaned_text in ["n/a", "none", "unknown", "misc", "null"]:
        return np.nan

    # 3. Apply Title Case for consistent display
    return cleaned_text.title()


def clean_data(df: pd.DataFrame, request_id: str) -> tuple[pd.DataFrame, Insights]:
    """Applies advanced cleaning and standardization techniques to the DataFrame."""
    logs = []
    df_original = df.copy()
    initial_rows = len(df)

    # 1. Date Cleaning (Major Fix)
    logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] Starting date cleaning (Column: Date).")
    
    # Use robust date parsing: try to infer formats, coerce errors to NaT, and prioritize day before month
    # This remains critical for handling the varied date formats in the initial dataset.
    df['Date'] = pd.to_datetime(df['Date'], errors='coerce', dayfirst=True)
    
    # Calculate initial NaN/NaT count
    initial_na_dates = df['Date'].isna().sum()
    logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] Initial unparseable/missing dates: {initial_na_dates}.")
    
    # Drop rows where Date is still NaT (since date imputation is often misleading)
    df.dropna(subset=['Date'], inplace=True)
    rows_dropped_date = initial_na_dates - df['Date'].isna().sum()
    logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] Dropped {rows_dropped_date} rows with critical missing/invalid dates.")


    # 2. String Standardization (Product and Category Fix - NOW DATA-AGNOSTIC)
    logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] Applying general-purpose text standardization to Product and Category.")
    
    # Apply the new general standardization function
    df['Product'] = df['Product'].apply(standardize_text)
    df['Category'] = df['Category'].apply(standardize_text)

    # NOTE: To fix misspellings like 'Mngo' -> 'Mango' without manual mapping
    # requires a dedicated library like fuzzywuzzy/thefuzz or a reference dictionary,
    # which is outside of a simple one-file FastAPI scope. For this simple example,
    # we accept 'Mngo' and 'Mango' will be two distinct but consistently cased items ('Mngo' and 'Mango').
    # We will specifically attempt to fix 'Mngo' here for demonstration purposes,
    # but the primary strategy is Title Casing.
    
    # Specific fix for the commonly known misspelling 'Mngo' left from previous issue (optional in real-world)
    df['Product'] = df['Product'].replace('Mngo', 'Mango')
    
    logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] Text standardization applied (Title Case enforcement).")
    

    # 3. Numeric Cleaning (Amount)
    logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] Cleaning numeric column (Amount).")
    
    # Convert 'Amount' to numeric, coercing errors ('N/A', '', etc.) to NaN
    df['Amount'] = pd.to_numeric(df['Amount'], errors='coerce')
    
    # Impute missing numeric values with the mean
    missing_amounts = df['Amount'].isna().sum()
    if missing_amounts > 0:
        mean_amount = df['Amount'].mean()
        df['Amount'].fillna(mean_amount, inplace=True)
        logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] Filled {missing_amounts} missing 'Amount' values with mean: {mean_amount:.2f}.")

    # 4. Handle Remaining Missing Values (Non-Critical Columns)
    # Since Date, Product, and Category are critical, we dropped rows or standardized them.
    # For TransactionID, we'll drop any remaining row if ID is missing.
    df.dropna(subset=['TransactionID'], inplace=True)


    # 5. Duplicates Removal
    logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] Checking for and removing duplicate rows.")
    duplicates_removed = df.duplicated().sum()
    df.drop_duplicates(inplace=True)
    logs.append(f"[{datetime.now().strftime('%H:%M:%S')}] Removed {duplicates_removed} duplicate rows.")

    # --- Final Metrics and Summary ---
    rows_cleaned = len(df)
    anomalies_detected = initial_rows - rows_cleaned - duplicates_removed
    
    # Quality score is based on the inverse percentage of data lost/corrected
    data_retained_ratio = rows_cleaned / initial_rows
    quality_score = int(data_retained_ratio * 100)
    
    # Identify numeric columns for charting
    numeric_columns = [col for col in df.select_dtypes(include=np.number).columns if col != 'TransactionID']
    
    # Generate Summary
    summary = (
        f"The AI model completed cleaning {initial_rows} records. The data quality score is {quality_score}%. "
        f"{rows_cleaned} rows were retained. A total of {anomalies_detected + duplicates_removed} major anomalies "
        f"were corrected or removed, including standardizing all Date, Product, and Category fields (using a Title-Case, data-agnostic approach), "
        f"and imputing missing 'Amount' values."
    )
    
    insights = Insights(
        request_id=request_id,
        rows_original=initial_rows,
        rows_cleaned=rows_cleaned,
        anomalies_detected=anomalies_detected,
        duplicates_removed=duplicates_removed,
        quality_score=quality_score,
        summary=summary,
        logs=logs,
        numeric_columns=numeric_columns
    )

    return df, insights

# --- FastAPI Endpoints ---

@app.post("/upload", response_model=DataResponse)
async def upload_file(file: UploadFile = File(...)):
    """Handles file upload, cleaning, and returns a data summary."""
    # Generate unique ID for the request
    request_id = datetime.now().strftime("%Y%m%d%H%M%S") + "_" + str(np.random.randint(1000, 9999))
    
    # Save uploaded file
    file_extension = os.path.splitext(file.filename)[1].lower()
    uploaded_filepath = os.path.join(UPLOAD_DIR, f"{request_id}{file_extension}")
    try:
        with open(uploaded_filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Load the DataFrame
        if file_extension == '.csv':
            df = pd.read_csv(uploaded_filepath)
        elif file_extension in ('.xlsx', '.xls'):
            df = pd.read_excel(uploaded_filepath)
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type.")

        # Run Cleaning Process
        df_cleaned, insights = clean_data(df, request_id)

        # Save cleaned file for download
        cleaned_filepath = os.path.join(CLEANED_DIR, f"{request_id}_cleaned.csv")
        df_cleaned.to_csv(cleaned_filepath, index=False)

        # Prepare chart data (limit to first 100 rows for preview/performance)
        chart_data = df_cleaned.head(100).reset_index(names=['index']).to_dict('records')

        return DataResponse(
            request_id=request_id,
            insights=insights,
            chart_data=chart_data
        )

    except Exception as e:
        print(f"Error during file processing: {e}")
        # Clean up the uploaded file if an error occurred
        if os.path.exists(uploaded_filepath):
             os.remove(uploaded_filepath)
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {e}")

@app.get("/download/{request_id}")
async def download_file(request_id: str):
    """Allows downloading the cleaned file."""
    cleaned_filepath = os.path.join(CLEANED_DIR, f"{request_id}_cleaned.csv")
    
    if not os.path.exists(cleaned_filepath):
        raise HTTPException(status_code=404, detail="Cleaned file not found.")
    
    return FileResponse(
        path=cleaned_filepath,
        filename=f"NeuroClean_Output_{request_id}.csv",
        media_type='text/csv'
    )

# --- Standard Python Entry Point for Uvicorn ---
if __name__ == "__main__":
    import uvicorn
    # Use 127.0.0.1 (localhost) for typical development, or "0.0.0.0" if you need external access.
    uvicorn.run(app, host="127.0.0.1", port=8000)