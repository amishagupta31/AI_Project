import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler, LabelEncoder
from io import BytesIO
import re
from datetime import datetime
import warnings
from difflib import SequenceMatcher

warnings.filterwarnings("ignore")

# --- Constants ---
EMAIL_PATTERN = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
PHONE_PATTERN = r'(?:\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}'

# --- HELPER: Correlation Matrix (NEW) ---
def get_correlation_matrix(df):
    """
    Calculates the correlation between all numeric columns.
    Returns a list of {x, y, value} for plotting a heatmap.
    """
    numeric_df = df.select_dtypes(include=[np.number])
    if numeric_df.shape[1] < 2:
        return []
    
    corr = numeric_df.corr().round(2)
    matrix = []
    
    for i, col1 in enumerate(corr.columns):
        for j, col2 in enumerate(corr.columns):
            matrix.append({
                "x": col1,
                "y": col2,
                "value": corr.iloc[i, j]
            })
    return matrix

# --- HELPER: Column Statistics ---
def get_column_stats(df):
    stats = []
    for col in df.columns:
        if pd.api.types.is_numeric_dtype(df[col]):
            dtype = "Numeric"
        elif pd.api.types.is_datetime64_any_dtype(df[col]):
            dtype = "Date"
        else:
            dtype = "Text"
            
        missing = int(df[col].isnull().sum())
        unique = int(df[col].nunique())
        
        stat = {
            "name": col,
            "type": dtype,
            "missing": missing,
            "unique": unique,
            "sample": str(df[col].dropna().iloc[0]) if not df[col].dropna().empty else "N/A"
        }
        stats.append(stat)
    return stats

# --- HELPER: Aggressive Date Parsing ---
def smart_parse_dates(series):
    parsed = pd.to_datetime(series, errors='coerce')
    mask_null = parsed.isna()
    if mask_null.any():
        parsed.loc[mask_null] = pd.to_datetime(series[mask_null], dayfirst=True, errors='coerce')
    mask_null = parsed.isna()
    if mask_null.any():
        formats = ['%d-%m-%Y', '%m-%d-%Y', '%Y/%m/%d', '%d/%m/%Y', '%b %d %Y', '%d-%b-%Y']
        for fmt in formats:
            mask_still_null = parsed.isna()
            if not mask_still_null.any(): break
            try:
                parsed.loc[mask_still_null] = pd.to_datetime(series[mask_still_null], format=fmt, errors='coerce')
            except:
                continue
    return parsed

# --- HELPER: Aggressive Spelling Correction ---
def smart_text_correction(df, logs):
    text_cols = df.select_dtypes(include=['object']).columns
    for col in text_cols:
        if df[col].nunique() > len(df) * 0.9: continue
        value_counts = df[col].value_counts()
        all_vals = value_counts.index.tolist()
        corrections = {}
        for i, val1 in enumerate(all_vals):
            if not isinstance(val1, str): continue
            for j, val2 in enumerate(all_vals):
                if i == j: continue
                if not isinstance(val2, str): continue
                ratio = SequenceMatcher(None, val1.lower(), val2.lower()).ratio()
                if ratio > 0.75:
                    count1 = value_counts[val1]
                    count2 = value_counts[val2]
                    if count2 > count1 * 2:
                        corrections[val1] = val2
                        if f"Auto-Corrected '{val1}'" not in logs:
                            logs.append(f"Auto-Corrected '{val1}' to '{val2}' in {col}")
        if corrections:
            df[col] = df[col].replace(corrections)
    return df

def clean_currency_value(val):
    if pd.isna(val): return np.nan
    val_str = str(val).lower().strip()
    val_str = re.sub(r'[₹$€£,]', '', val_str)
    if 'k' in val_str:
        try:
            return float(val_str.replace('k', '')) * 1000
        except:
            return np.nan
    return val_str

def detect_and_mask_pii(df):
    pii_count = 0
    df_masked = df.copy()
    text_cols = df_masked.select_dtypes(include=['object']).columns
    for col in text_cols:
        mask_email = df_masked[col].astype(str).str.contains(EMAIL_PATTERN, regex=True, na=False)
        if mask_email.any():
            pii_count += mask_email.sum()
            df_masked.loc[mask_email, col] = df_masked.loc[mask_email, col].astype(str).apply(
                lambda x: re.sub(EMAIL_PATTERN, lambda m: m.group(0)[0] + "***@" + m.group(0).split('@')[1], x)
            )
        mask_phone = df_masked[col].astype(str).str.contains(PHONE_PATTERN, regex=True, na=False)
        if mask_phone.any():
            pii_count += mask_phone.sum()
            df_masked.loc[mask_phone, col] = df_masked.loc[mask_phone, col].astype(str).apply(
                lambda x: re.sub(PHONE_PATTERN, "********", x)
            )
    return df_masked, int(pii_count)

def generate_sql_log(df, table_name="cleaned_dataset"):
    sql_buffer = []
    sql_buffer.append(f"-- SQL Schema and Data generated by InfoPulse AI")
    sql_buffer.append(f"CREATE TABLE {table_name} (")
    cols = []
    for col, dtype in df.dtypes.items():
        col_name = str(col).strip().replace(' ', '_').replace('-', '_').replace('.', '')
        if pd.api.types.is_integer_dtype(dtype): sql_type = "INT"
        elif pd.api.types.is_float_dtype(dtype): sql_type = "FLOAT"
        elif pd.api.types.is_datetime64_any_dtype(dtype): sql_type = "TIMESTAMP"
        else: sql_type = "TEXT"
        cols.append(f"    {col_name} {sql_type}")
    sql_buffer.append(",\n".join(cols))
    sql_buffer.append(");\n")
    sql_buffer.append("-- Inserting sample data (Top 50 rows for preview)")
    for _, row in df.head(50).iterrows():
        vals = []
        for v in row:
            if pd.isna(v): vals.append("NULL")
            elif isinstance(v, str): 
                safe_v = v.replace("'", "''")
                vals.append(f"'{safe_v}'")
            elif isinstance(v, (datetime, pd.Timestamp)): vals.append(f"'{str(v)}'")
            else: vals.append(str(v))
        sql_buffer.append(f"INSERT INTO {table_name} VALUES ({', '.join(vals)});")
    return "\n".join(sql_buffer)

def generate_smart_summary(original_rows, clean_rows, duplicates, anomalies, pii_masked, quality_score, mask_pii_enabled):
    summary = f"Dataset Analysis Complete. Processed {original_rows} rows. "
    if quality_score > 90: summary += "Data quality is excellent. "
    elif quality_score > 70: summary += "Data quality is fair. "
    else: summary += "Critical issues found; significant cleaning performed. "
    summary += f"Removed {duplicates} duplicates and {anomalies} anomalies. "
    if mask_pii_enabled and pii_masked > 0: summary += f"⚠️ {pii_masked} PII instances masked. "
    return summary

def process_dataset(file_content, filename, mask_pii=True):
    try:
        if filename.endswith('.csv'):
            try: df = pd.read_csv(BytesIO(file_content), encoding='utf-8')
            except: df = pd.read_csv(BytesIO(file_content), encoding='latin1')
        elif filename.endswith('.xlsx'):
            df = pd.read_excel(BytesIO(file_content))
        else: raise ValueError("Unsupported file type")
    except Exception as e: raise ValueError(f"File could not be read: {str(e)}")

    original_shape = df.shape
    logs = []
    
    preview_original = df.head(50).replace({np.nan: None}).to_dict(orient='records')

    # Text Standardization
    for col in df.columns:
        if pd.api.types.is_object_dtype(df[col]):
            df[col] = df[col].astype(str).str.strip().str.title()
            df[col] = df[col].replace({'Nan': 'Unknown', 'None': 'Unknown', 'Na': 'Unknown', 'Pc': 'Piece', 'N/A': 'Unknown'})

    # Smart Type Inference
    for col in df.columns:
        if pd.api.types.is_object_dtype(df[col]):
            temp_col = pd.to_numeric(df[col], errors='coerce')
            if (temp_col.notna().sum() / len(df)) < 0.40:
                cleaned_col_series = df[col].apply(clean_currency_value)
                temp_col_cleaned = pd.to_numeric(cleaned_col_series, errors='coerce')
                if (temp_col_cleaned.notna().sum() / len(df)) > 0.40:
                    temp_col = temp_col_cleaned
                    logs.append(f"Smart-Parsed '{col}' as Numeric")
            if (temp_col.notna().sum() / len(df)) > 0.40:
                df[col] = temp_col

    # Smart Text Correction
    df = smart_text_correction(df, logs)

    # Date Parsing & Numeric Filling
    for col in df.columns:
        if 'date' in col.lower() or 'time' in col.lower():
            df[col] = smart_parse_dates(df[col])
            logs.append(f"Formatted {col} to DateTime")
        if pd.api.types.is_numeric_dtype(df[col]):
            if df[col].isnull().sum() > 0:
                med = df[col].median()
                if pd.isna(med): med = 0
                df[col] = df[col].fillna(med)

    # Deduplicate
    before_dedup = len(df)
    df = df.drop_duplicates()
    duplicates_removed = before_dedup - len(df)

    # PII
    pii_count = 0
    if mask_pii:
        df, pii_count = detect_and_mask_pii(df)
        if pii_count > 0: logs.append(f"🔒 Masked {pii_count} PII items")

    # Anomaly Detection
    df_for_ai = df.copy()
    numeric_cols_model = df_for_ai.select_dtypes(include=[np.number]).columns.tolist()
    categorical_cols = df.select_dtypes(include=['object', 'category']).columns
    for col in categorical_cols:
        le = LabelEncoder()
        df_for_ai[col] = le.fit_transform(df[col].astype(str))
    
    anomaly_count = 0
    if len(numeric_cols_model) > 0:
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

    # Output
    if original_shape[0] > 0:
        quality_score = max(0, 100 - ((original_shape[0] - df_clean.shape[0]) / original_shape[0] * 100))
    else: quality_score = 0
    
    smart_summary = generate_smart_summary(original_shape[0], df_clean.shape[0], duplicates_removed, anomaly_count, pii_count, quality_score, mask_pii)
    generated_sql = generate_sql_log(df_clean)
    column_stats = get_column_stats(df_clean)
    
    # --- NEW: Get Correlation Matrix ---
    correlation_matrix = get_correlation_matrix(df_clean)

    chart_df = df_clean.copy()
    for col in chart_df.columns:
        if pd.api.types.is_datetime64_any_dtype(chart_df[col]):
            chart_df[col] = chart_df[col].dt.strftime('%Y-%m-%d')
            
    numeric_cols_output = df_clean.select_dtypes(include=[np.number]).columns.tolist()
    preview_cleaned = chart_df.head(50).reset_index(names=['index']).replace({np.nan: None, np.inf: None, -np.inf: None}).to_dict(orient='records')

    insights = {
        "rows_original": original_shape[0],
        "rows_cleaned": df_clean.shape[0],
        "duplicates_removed": duplicates_removed,
        "anomalies_detected": anomaly_count,
        "pii_masked": pii_count,
        "quality_score": round(quality_score, 2),
        "logs": logs[:15],
        "numeric_columns": numeric_cols_output,
        "summary": smart_summary,
        "generated_sql": generated_sql,
        "column_stats": column_stats,
        "correlation_matrix": correlation_matrix # New Field
    }

    return df_clean, insights, preview_original, preview_cleaned