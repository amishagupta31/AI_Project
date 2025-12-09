import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler, LabelEncoder
from io import BytesIO

def generate_smart_summary(original_rows, clean_rows, duplicates, anomalies, quality_score):
    loss_pct = round((1 - (clean_rows / original_rows)) * 100, 1)
    summary = f"The dataset initially contained {original_rows} rows. "
    
    if quality_score > 90:
        summary += "The data quality is excellent. "
    elif quality_score > 70:
        summary += "The data quality is good, though some cleaning was required. "
    else:
        summary += "The data quality is poor. "
        
    summary += f"We detected {duplicates} duplicates and {anomalies} statistical anomalies. "
    summary += f"In total, {loss_pct}% of the data was filtered."
    return summary

def process_dataset(file_content, filename):
    # 1. Load Data
    try:
        if filename.endswith('.csv'):
            try:
                df = pd.read_csv(BytesIO(file_content), encoding='utf-8')
            except UnicodeDecodeError:
                df = pd.read_csv(BytesIO(file_content), encoding='latin1')
        elif filename.endswith('.xlsx'):
            df = pd.read_excel(BytesIO(file_content))
        else:
            raise ValueError("Unsupported file type")
    except Exception as e:
        raise ValueError(f"File could not be read: {str(e)}")

    original_shape = df.shape
    logs = []

    # 2. Clean Data (Types & Missing Values)
    for col in df.columns:
        # Dates
        if 'date' in col.lower() or 'time' in col.lower():
            df[col] = pd.to_datetime(df[col], errors='coerce')
            logs.append(f"Formatted {col} to DateTime")

        # Numeric
        if pd.api.types.is_numeric_dtype(df[col]):
            if df[col].isnull().sum() > 0:
                med = df[col].median()
                # SAFETY CHECK: If column is all NaN, median is NaN. default to 0
                if pd.isna(med): 
                    med = 0
                df[col] = df[col].fillna(med)
                logs.append(f"Filled missing numbers in {col} with {med}")
        
        # Text
        elif pd.api.types.is_object_dtype(df[col]):
            df[col] = df[col].astype(str).str.strip().str.title()
            df[col] = df[col].replace({'Nan': 'Unknown', 'None': 'Unknown', 'Na': 'Unknown'})
            logs.append(f"Standardized text in {col}")

    # 3. Deduplicate
    before_dedup = len(df)
    df = df.drop_duplicates()
    duplicates_removed = before_dedup - len(df)

    # 4. Advanced AI (With Categorical Encoding)
    df_for_ai = df.copy()
    categorical_cols = df.select_dtypes(include=['object', 'category']).columns
    
    for col in categorical_cols:
        le = LabelEncoder()
        # Ensure we convert to string before encoding to avoid TypeError
        df_for_ai[col] = le.fit_transform(df[col].astype(str))

    # Select features (Numbers + Encoded Text)
    # We exclude purely datetime columns from the model usually
    numeric_cols_model = df_for_ai.select_dtypes(include=[np.number]).columns.tolist()
    anomaly_count = 0
    
    if len(numeric_cols_model) > 0:
        # Handle any remaining NaNs in AI data by filling with 0
        df_for_ai = df_for_ai.fillna(0)
        
        scaler = StandardScaler()
        scaled_data = scaler.fit_transform(df_for_ai[numeric_cols_model])
        
        iso = IsolationForest(contamination=0.05, random_state=42)
        preds = iso.fit_predict(scaled_data)
        
        df['anomaly_score'] = preds
        anomaly_count = list(preds).count(-1)
        
        df_clean = df[df['anomaly_score'] == 1].drop(columns=['anomaly_score'])
    else:
        df_clean = df

    # 5. Summary & Output
    if original_shape[0] > 0:
        total_issues = (original_shape[0] - df_clean.shape[0])
        quality_score = max(0, 100 - (total_issues / original_shape[0] * 100))
    else:
        quality_score = 0
    
    smart_summary = generate_smart_summary(original_shape[0], df_clean.shape[0], duplicates_removed, anomaly_count, quality_score)
    
    # Prepare chart data (Dates to string)
    chart_df = df_clean.copy()
    for col in chart_df.columns:
        if pd.api.types.is_datetime64_any_dtype(chart_df[col]):
            chart_df[col] = chart_df[col].dt.strftime('%Y-%m-%d')
            
    numeric_cols_output = df_clean.select_dtypes(include=[np.number]).columns.tolist()

    insights = {
        "rows_original": original_shape[0],
        "rows_cleaned": df_clean.shape[0],
        "duplicates_removed": duplicates_removed,
        "anomalies_detected": anomaly_count,
        "quality_score": round(quality_score, 2),
        "logs": logs[:10],
        "numeric_columns": numeric_cols_output,
        "summary": smart_summary
    }

    # --- CRITICAL FIX: SANITIZE JSON ---
    # Convert NaN, Infinity, -Infinity to None (which becomes null in JSON)
    clean_records = chart_df.head(100).replace({np.nan: None, np.inf: None, -np.inf: None}).to_dict(orient='records')

    return df_clean, insights, clean_records