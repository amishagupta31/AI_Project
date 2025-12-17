import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler, LabelEncoder
from io import BytesIO
import re
from datetime import datetime
import warnings
from difflib import SequenceMatcher

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as ReportLabImage
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

warnings.filterwarnings("ignore")

# --- Constants ---
EMAIL_PATTERN = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
PHONE_PATTERN = r'(?:\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}'

# --- HELPER: Correlation Matrix ---
def get_correlation_matrix(df):
    numeric_df = df.select_dtypes(include=[np.number])
    if numeric_df.shape[1] < 2: return []
    corr = numeric_df.corr().round(2)
    matrix = []
    for i, col1 in enumerate(corr.columns):
        for j, col2 in enumerate(corr.columns):
            matrix.append({"x": col1, "y": col2, "value": corr.iloc[i, j]})
    return matrix

# --- HELPER: Column Statistics ---
def get_column_stats(df):
    stats = []
    for col in df.columns:
        if pd.api.types.is_numeric_dtype(df[col]): dtype = "Numeric"
        elif pd.api.types.is_datetime64_any_dtype(df[col]): dtype = "Date"
        else: dtype = "Text"
        missing = int(df[col].isnull().sum())
        unique = int(df[col].nunique())
        top_values = {}
        if unique > 0:
            try:
                val_counts = df[col].value_counts().head(5)
                top_values = {str(k): int(v) for k, v in val_counts.items()}
            except: pass
        stats.append({
            "name": col, "type": dtype, "missing": missing, "unique": unique,
            "sample": str(df[col].dropna().iloc[0]) if not df[col].dropna().empty else "N/A",
            "top_values": top_values
        })
    return stats

# --- HELPER: Aggressive Date Parsing ---
def smart_parse_dates(series):
    parsed = pd.to_datetime(series, errors='coerce')
    mask_null = parsed.isna()
    if mask_null.any(): parsed.loc[mask_null] = pd.to_datetime(series[mask_null], dayfirst=True, errors='coerce')
    mask_null = parsed.isna()
    if mask_null.any():
        formats = ['%d-%m-%Y', '%m-%d-%Y', '%Y/%m/%d', '%d/%m/%Y', '%b %d %Y', '%d-%b-%Y']
        for fmt in formats:
            mask_still_null = parsed.isna()
            if not mask_still_null.any(): break
            try: parsed.loc[mask_still_null] = pd.to_datetime(series[mask_still_null], format=fmt, errors='coerce')
            except: continue
    return parsed

# --- HELPER: Smart Text Correction ---
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
                    if value_counts[val2] > value_counts[val1] * 2:
                        corrections[val1] = val2
                        if f"Auto-Corrected '{val1}'" not in logs: logs.append(f"Auto-Corrected '{val1}' to '{val2}' in {col}")
        if corrections: df[col] = df[col].replace(corrections)
    return df

def clean_currency_value(val):
    if pd.isna(val): return np.nan
    val_str = str(val).lower().strip()
    val_str = re.sub(r'[₹$€£,]', '', val_str)
    if 'k' in val_str:
        try: return float(val_str.replace('k', '')) * 1000
        except: return np.nan
    return val_str

def detect_and_mask_pii(df):
    pii_count = 0
    df_masked = df.copy()
    text_cols = df_masked.select_dtypes(include=['object']).columns
    for col in text_cols:
        mask_email = df_masked[col].astype(str).str.contains(EMAIL_PATTERN, regex=True, na=False)
        if mask_email.any():
            pii_count += mask_email.sum()
            df_masked.loc[mask_email, col] = df_masked.loc[mask_email, col].astype(str).apply(lambda x: re.sub(EMAIL_PATTERN, lambda m: m.group(0)[0] + "***@" + m.group(0).split('@')[1], x))
        mask_phone = df_masked[col].astype(str).str.contains(PHONE_PATTERN, regex=True, na=False)
        if mask_phone.any():
            pii_count += mask_phone.sum()
            df_masked.loc[mask_phone, col] = df_masked.loc[mask_phone, col].astype(str).apply(lambda x: re.sub(PHONE_PATTERN, "********", x))
    return df_masked, int(pii_count)

def generate_sql_log(df, table_name="cleaned_dataset"):
    sql_buffer = [f"-- SQL Schema and Data generated by InfoPulse AI", f"CREATE TABLE {table_name} ("]
    cols = []
    for col, dtype in df.dtypes.items():
        col_name = str(col).strip().replace(' ', '_').replace('-', '_').replace('.', '')
        if pd.api.types.is_integer_dtype(dtype): sql_type = "INT"
        elif pd.api.types.is_float_dtype(dtype): sql_type = "FLOAT"
        elif pd.api.types.is_datetime64_any_dtype(dtype): sql_type = "TIMESTAMP"
        else: sql_type = "TEXT"
        cols.append(f"    {col_name} {sql_type}")
    sql_buffer.append(",\n".join(cols) + "\n);\n-- Inserting sample data (Top 50 rows)")
    for _, row in df.head(50).iterrows():
        vals = []
        for v in row:
            if pd.isna(v): 
                vals.append("NULL")
            elif isinstance(v, str): 
                # Fixed quote escaping issue
                safe_v = v.replace("'", "''")
                vals.append(f"'{safe_v}'")
            elif isinstance(v, (datetime, pd.Timestamp)): 
                vals.append(f"'{str(v)}'")
            else: 
                vals.append(str(v))
        sql_buffer.append(f"INSERT INTO {table_name} VALUES ({', '.join(vals)});")
    return "\n".join(sql_buffer)

def generate_smart_summary(original, clean, dups, anom, pii, score, mask_pii):
    summary = f"Dataset Analysis Complete. Processed {original} rows. "
    if score > 90: summary += "Data quality is excellent. "
    elif score > 70: summary += "Data quality is fair. "
    else: summary += "Critical issues found; significant cleaning performed. "
    summary += f"Removed {dups} duplicates and {anom} anomalies. "
    if mask_pii and pii > 0: summary += f"⚠️ {pii} PII instances masked. "
    return summary

def generate_pdf_report(df, insights, output_path):
    doc = SimpleDocTemplate(output_path, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []

    # Title
    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontSize=24, spaceAfter=20, textColor=colors.HexColor("#4f46e5"))
    story.append(Paragraph("InfoPulse AI - Data Quality Report", title_style))
    story.append(Paragraph(f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M')}", styles['Normal']))
    story.append(Spacer(1, 20))

    # Health Score Box
    score = insights['quality_score']
    score_color = colors.green if score > 80 else colors.orange if score > 50 else colors.red
    story.append(Paragraph(f"Data Health Score: <font color={score_color} size=18><b>{score}%</b></font>", styles['Heading2']))
    story.append(Spacer(1, 10))

    # Summary
    story.append(Paragraph("Executive Summary", styles['Heading2']))
    story.append(Paragraph(insights['summary'], styles['Normal']))
    story.append(Spacer(1, 20))

    # Metrics Table
    story.append(Paragraph("Key Metrics", styles['Heading3']))
    data_metrics = [
        ['Metric', 'Value'],
        ['Original Rows', f"{insights['rows_original']}"],
        ['Cleaned Rows', f"{insights['rows_cleaned']}"],
        ['Duplicates Removed', f"{insights['duplicates_removed']}"],
        ['Anomalies Detected', f"{insights['anomalies_detected']}"],
        ['PII Masked', f"{insights['pii_masked']}"]
    ]
    t = Table(data_metrics, colWidths=[200, 100])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor("#e5e7eb")),
    ]))
    story.append(t)
    story.append(Spacer(1, 20))

    # Visual: Distribution of main numeric column
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols) > 0:
        main_col = numeric_cols[0]
        story.append(Paragraph(f"Distribution Analysis: {main_col}", styles['Heading3']))
        
        plt.figure(figsize=(6, 3))
        df[main_col].hist(bins=20, color='#6366f1', alpha=0.7, grid=False)
        plt.title(f"Distribution of {main_col}")
        plt.xlabel(main_col)
        plt.ylabel("Frequency")
        plt.tight_layout()
        
        img_buffer = BytesIO()
        plt.savefig(img_buffer, format='png', dpi=100)
        img_buffer.seek(0)
        
        img = ReportLabImage(img_buffer, width=400, height=200)
        story.append(img)
        plt.close()
        story.append(Spacer(1, 20))

    # Column Stats
    story.append(Paragraph("Detailed Column Statistics", styles['Heading3']))
    col_data = [['Column', 'Type', 'Missing', 'Unique']]
    for col in insights['column_stats']:
        col_data.append([col['name'], col['type'], str(col['missing']), str(col['unique'])])
    
    t_cols = Table(col_data, colWidths=[150, 80, 80, 80])
    t_cols.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#e0e7ff")),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
    ]))
    story.append(t_cols)

    doc.build(story)


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

    for col in df.columns:
        if pd.api.types.is_object_dtype(df[col]):
            df[col] = df[col].astype(str).str.strip().str.title()
            df[col] = df[col].replace({'Nan': 'Unknown', 'None': 'Unknown', 'Na': 'Unknown', 'Pc': 'Piece', 'N/A': 'Unknown'})

    for col in df.columns:
        if pd.api.types.is_object_dtype(df[col]):
            temp_col = pd.to_numeric(df[col], errors='coerce')
            if (temp_col.notna().sum() / len(df)) < 0.40:
                cleaned = df[col].apply(clean_currency_value)
                temp_col_cleaned = pd.to_numeric(cleaned, errors='coerce')
                if (temp_col_cleaned.notna().sum() / len(df)) > 0.40:
                    temp_col = temp_col_cleaned
                    logs.append(f"Smart-Parsed '{col}' as Numeric")
            if (temp_col.notna().sum() / len(df)) > 0.40: df[col] = temp_col

    df = smart_text_correction(df, logs)

    for col in df.columns:
        if 'date' in col.lower() or 'time' in col.lower():
            df[col] = smart_parse_dates(df[col])
            logs.append(f"Formatted {col} to DateTime")
        if pd.api.types.is_numeric_dtype(df[col]):
            if df[col].isnull().sum() > 0:
                med = df[col].median()
                if pd.isna(med): med = 0
                df[col] = df[col].fillna(med)

    before_dedup = len(df)
    df = df.drop_duplicates()
    duplicates_removed = before_dedup - len(df)

    pii_count = 0
    if mask_pii:
        df, pii_count = detect_and_mask_pii(df)
        if pii_count > 0: logs.append(f"🔒 Masked {pii_count} PII items")

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

    if original_shape[0] > 0: quality_score = max(0, 100 - ((original_shape[0] - df_clean.shape[0]) / original_shape[0] * 100))
    else: quality_score = 0
    
    smart_summary = generate_smart_summary(original_shape[0], df_clean.shape[0], duplicates_removed, anomaly_count, pii_count, quality_score, mask_pii)
    generated_sql = generate_sql_log(df_clean)
    column_stats = get_column_stats(df_clean)
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
        "correlation_matrix": correlation_matrix
    }

    return df_clean, insights, preview_original, preview_cleaned