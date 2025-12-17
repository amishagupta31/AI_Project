import React, { useState, useMemo } from 'react';
import axios from 'axios';
import { 
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, ZAxis 
} from 'recharts';
import { 
  Upload, Download, FileText, AlertTriangle, CheckCircle, Loader2, 
  BarChart3, LineChart as LineIcon, ShieldCheck, Database, LayoutDashboard, Code, Copy, 
  ArrowRight, Filter, Trash2, UserX, Table, PieChart as PieIcon, Activity, ArrowUpDown, Search, X, RefreshCw, FileSpreadsheet, ScatterChart as ScatterIcon, Sparkles, FileText as PdfIcon
} from 'lucide-react';

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [requestId, setRequestId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); 
  const [selectedColumn, setSelectedColumn] = useState('');
  const [yColumn, setYColumn] = useState('');
  const [chartType, setChartType] = useState('Bar');
  const [maskPii, setMaskPii] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const COLORS = ['#6366f1', '#fbbf24', '#f43f5e']; 
  const GAUGE_COLORS = ['#ef4444', '#eab308', '#22c55e'];

  const handleReset = () => {
    setFile(null);
    setData(null);
    setRequestId(null);
    setSearchQuery('');
    setAiError('');
    setActiveTab('overview');
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setData(null);
    setSearchQuery(''); 
    setActiveTab('overview');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mask_pii', maskPii);
    try {
      const response = await axios.post('http://localhost:8000/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setData(response.data);
      setRequestId(response.data.request_id);
      if (response.data.insights.numeric_columns.length > 0) {
        const numericCols = response.data.insights.numeric_columns;
        const priorityCol = numericCols.find(col => ['salary', 'age', 'amount', 'price', 'score', 'rating', 'total', 'profit', 'cost'].includes(col.toLowerCase()));
        setSelectedColumn(priorityCol || numericCols[0]);
        setYColumn(numericCols.length > 1 ? numericCols[1] : (priorityCol || numericCols[0]));
      }
    } catch (error) { console.error(error); alert("Error processing file. Please ensure the backend is running."); } finally { setLoading(false); }
  };

  const handleAskAI = async (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
        if (searchQuery.match(/[><=]/)) return;
        setAiLoading(true);
        setAiError('');
        try {
            const allColumns = data.insights.column_stats.map(c => c.name);
            const response = await axios.post('http://localhost:8000/ask', { query: searchQuery, columns: allColumns });
            if (response.data.filter_string) {
                setSearchQuery(response.data.filter_string);
                setAiError(response.data.explanation);
                setTimeout(() => setAiError(''), 3000);
            } else { setAiError(response.data.explanation); }
        } catch (error) { console.error("AI Error", error); } finally { setAiLoading(false); }
    }
  };

  const downloadFile = (format) => {
    if (requestId) { window.location.href = `http://localhost:8000/download/${requestId}?format=${format}`; }
  };

  const copyToClipboard = () => {
    if(data?.insights?.generated_sql) {
        navigator.clipboard.writeText(data.insights.generated_sql);
        const btn = document.getElementById('copy-btn-text');
        if(btn) { const original = btn.innerText; btn.innerText = "Copied!"; setTimeout(() => btn.innerText = original, 2000); }
    }
  };

  const filteredData = useMemo(() => {
    if (!data || !data.preview_cleaned) return [];
    if (!searchQuery.trim()) return data.preview_cleaned;
    const query = searchQuery.toLowerCase();
    return data.preview_cleaned.filter(row => {
        const operatorMatch = query.match(/([a-zA-Z0-9_]+)\s*([><=])\s*(.+)/);
        if (operatorMatch) {
             const [_, colName, op, val] = operatorMatch;
             const rowKey = Object.keys(row).find(k => k.toLowerCase() === colName.toLowerCase());
             if (rowKey && row[rowKey] !== undefined) {
                 const rowVal = Number(row[rowKey]);
                 const targetVal = Number(val);
                 if (!isNaN(rowVal) && !isNaN(targetVal)) {
                     if (op === '>') return rowVal > targetVal;
                     if (op === '<') return rowVal < targetVal;
                     if (op === '=') return rowVal === targetVal;
                 } else { if (op === '=') return String(row[rowKey]).toLowerCase().includes(String(val).toLowerCase()); }
             }
             return false;
        }
        return Object.values(row).some(val => String(val).toLowerCase().includes(query));
    });
  }, [data, searchQuery]);

  // --- SUB-COMPONENTS ---
  const GaugeChart = ({ score }) => {
    let color = GAUGE_COLORS[0];
    if (score > 50) color = GAUGE_COLORS[1];
    if (score > 80) color = GAUGE_COLORS[2];
    const pieData = [{ name: 'Score', value: score }, { name: 'Remaining', value: 100 - score }];
    return (
        <div className="relative w-48 h-24 mx-auto overflow-hidden group hover:scale-105 transition-transform duration-300">
             <ResponsiveContainer width="100%" height="200%">
                <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" startAngle={180} endAngle={0} innerRadius={60} outerRadius={80} paddingAngle={0} dataKey="value" stroke="none">
                        <Cell key="score" fill={color} /><Cell key="rest" fill="#e2e8f0" />
                    </Pie>
                </PieChart>
             </ResponsiveContainer>
             <div className="absolute bottom-0 w-full text-center"><p className="text-3xl font-extrabold text-slate-800">{score}%</p><p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Health Score</p></div>
        </div>
    );
  };

  const CorrelationHeatmap = ({ matrix }) => {
    if (!matrix || matrix.length === 0) return <div className="text-center text-slate-400 py-10 italic">No numeric correlations found.</div>;
    const keys = [...new Set(matrix.map(m => m.x))];
    return (
        <div className="overflow-x-auto custom-scrollbar pb-4">
            <div className="min-w-[500px]">
                <div className="grid" style={{ gridTemplateColumns: `60px repeat(${keys.length}, 1fr)` }}>
                    <div className="h-10"></div>
                    {keys.map(k => <div key={k} className="h-10 flex items-center justify-center font-bold text-[10px] uppercase text-slate-500 tracking-wider truncate px-1" title={k}>{k}</div>)}
                    {keys.map(y => (
                        <React.Fragment key={y}>
                            <div className="h-12 flex items-center justify-end pr-3 font-bold text-[10px] uppercase text-slate-500 tracking-wider truncate" title={y}>{y}</div>
                            {keys.map(x => {
                                const item = matrix.find(m => m.x === x && m.y === y);
                                const val = item ? item.value : 0;
                                let bg = val > 0 ? `rgba(99, 102, 241, ${val})` : `rgba(244, 63, 94, ${Math.abs(val)})`; 
                                return <div key={`${x}-${y}`} className="h-12 border border-white/50 flex items-center justify-center text-xs font-medium text-slate-700 hover:scale-110 transition-transform cursor-default" style={{ backgroundColor: bg, borderRadius: '4px' }}>{val}</div>;
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        </div>
    );
  };

  const DataTable = ({ data, title, color }) => {
    if (!data || data.length === 0) return <div className="p-12 text-center text-slate-400 italic bg-slate-50 rounded-2xl border border-dashed border-slate-300">No data matches your search.</div>;
    const [sortConfig, setSortConfig] = useState(null);
    const columns = Object.keys(data[0]);
    const sortedData = React.useMemo(() => {
        let sortableItems = [...data];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [data, sortConfig]);
    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') direction = 'descending';
        setSortConfig({ key, direction });
    };
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex-1 flex flex-col h-full animate-fade-in-up">
        <div className={`p-4 border-b border-slate-100 font-bold flex items-center justify-between ${color}`}>
          <div className="flex items-center space-x-2"><Database size={16} /> <span>{title}</span></div>
          <span className="text-xs bg-white/30 px-2 py-1 rounded-full">{data.length} rows</span>
        </div>
        <div className="overflow-x-auto flex-1 custom-scrollbar">
          <table className="w-full text-sm text-left text-slate-600">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
              <tr>
                {columns.map(col => (
                    <th key={col} className="px-4 py-3 font-semibold cursor-pointer hover:bg-slate-100 transition-colors group select-none" onClick={() => requestSort(col)}>
                        <div className="flex items-center space-x-1"><span>{col}</span><ArrowUpDown size={12} className="opacity-0 group-hover:opacity-50" /></div>
                    </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((row, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  {columns.map(col => (<td key={col} className="px-4 py-3 font-medium whitespace-nowrap max-w-[200px] truncate">{row[col] !== null ? String(row[col]) : <span className="text-rose-300 italic text-xs">null</span>}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const StatCard = ({ title, value, subtext, icon: Icon, color }) => (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-lg transition-all duration-300 group hover:-translate-y-1">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-xl ${color.bg} group-hover:scale-110 transition-transform`}><Icon size={24} className={color.text} /></div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${color.bg} ${color.text} uppercase tracking-wider`}>{title}</span>
      </div>
      <div className="space-y-1"><h3 className="text-3xl font-bold text-slate-800 tracking-tight">{value}</h3>{subtext && <p className="text-xs text-slate-500 font-medium">{subtext}</p>}</div>
    </div>
  );

  const ColumnCard = ({ col }) => {
    const hasTopValues = col.top_values && Object.keys(col.top_values).length > 0;
    const maxCount = hasTopValues ? Math.max(...Object.values(col.top_values)) : 1;
    return (
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:border-indigo-100 hover:shadow-md transition-all flex flex-col justify-between">
            <div>
                <div className="flex justify-between items-start mb-3">
                    <h4 className="font-bold text-slate-800 truncate pr-2" title={col.name}>{col.name}</h4>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${col.type === 'Numeric' ? 'bg-blue-50 text-blue-600' : col.type === 'Date' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>{col.type}</span>
                </div>
                <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center"><span className="text-slate-400 text-xs">Missing</span><div className={`font-mono font-bold ${col.missing > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>{col.missing}</div></div>
                    <div className="flex justify-between items-center"><span className="text-slate-400 text-xs">Unique</span><div className="font-mono font-bold text-slate-700">{col.unique}</div></div>
                </div>
            </div>
            {hasTopValues ? (
                <div className="mt-4 pt-3 border-t border-slate-50">
                    <p className="text-[10px] text-slate-400 mb-2 uppercase tracking-wider">Top Values</p>
                    <div className="space-y-2">
                        {Object.entries(col.top_values).map(([val, count], idx) => (
                            <div key={idx} className="flex items-center text-xs">
                                <div className="w-16 truncate text-slate-600 mr-2" title={val}>{val}</div>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(count / maxCount) * 100}%` }}></div></div>
                                <div className="ml-2 text-slate-400 font-mono text-[10px] w-6 text-right">{count}</div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="pt-2 border-t border-slate-50 mt-2"><p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider">Sample</p><p className="font-mono text-xs text-slate-600 truncate bg-slate-50 p-1.5 rounded border border-slate-100">{col.sample}</p></div>
            )}
        </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100 selection:text-indigo-700 pb-20">
      
      <nav className="bg-white/70 backdrop-blur-lg border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-50 transition-all">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={handleReset}>
          <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-2 rounded-xl shadow-lg shadow-indigo-200"><Database className="text-white" size={20} /></div>
          <div className="leading-tight"><span className="block text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-700 to-purple-700">InfoPulse <span className="font-extrabold">AI</span></span><span className="block text-[10px] text-slate-400 font-medium tracking-widest uppercase">Intelligent Data Cleaner</span></div>
        </div>
        {data && (<button onClick={handleReset} className="flex items-center space-x-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200"><RefreshCw size={16} /> <span>New Analysis</span></button>)}
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
        
        {!data && (
            <section className="text-center space-y-10 py-16 md:py-24 animate-fade-in-up">
                <div className="space-y-4">
                    <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 tracking-tight leading-tight">Clean Data. <br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500">Zero Effort.</span></h1>
                    <p className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed">Upload messy CSV or Excel files. Our AI automatically detects anomalies, fixes typos, protects PII, and generates SQL scripts.</p>
                </div>
                <div className="max-w-2xl mx-auto relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                    <div className="relative bg-white p-8 rounded-3xl shadow-2xl border border-slate-100">
                        <div className="border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center space-y-4 bg-slate-50/50 hover:bg-indigo-50/50 hover:border-indigo-300 transition-all cursor-pointer relative overflow-hidden" onClick={() => document.getElementById('file-upload').click()}>
                            <input id="file-upload" type="file" onChange={(e) => setFile(e.target.files[0])} accept=".csv,.xlsx" className="hidden"/>
                            <div className="bg-white p-4 rounded-full shadow-md text-indigo-600 mb-2"><Upload size={32} /></div>
                            <div className="text-center"><p className="text-lg font-bold text-slate-700">{file ? file.name : "Click to upload or drag and drop"}</p><p className="text-sm text-slate-400 mt-1">{file ? `${(file.size / 1024).toFixed(2)} KB ready` : "CSV or Excel (Max 50MB)"}</p></div>
                        </div>
                        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                             <button onClick={() => setMaskPii(!maskPii)} className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wide transition-all border ${maskPii ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'}`}><ShieldCheck size={16} /><span>{maskPii ? "PII Masking On" : "PII Masking Off"}</span></button>
                            <button onClick={handleUpload} disabled={loading || !file} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:shadow-none flex items-center justify-center">{loading ? <Loader2 className="animate-spin mr-2" size={20} /> : <ArrowRight className="mr-2" size={20} />}{loading ? "Analyzing..." : "Start Processing"}</button>
                        </div>
                    </div>
                </div>
            </section>
        )}

        {data && (
          <div className="space-y-6 animate-fade-in-up">
            
            <div className="sticky top-20 z-40 bg-white/80 backdrop-blur-md p-2 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between gap-4">
              <div className="flex space-x-1 overflow-x-auto no-scrollbar">
                {[{id: 'overview', icon: LayoutDashboard}, {id: 'details', icon: Activity}, {id: 'data', icon: Table}, {id: 'charts', icon: BarChart3}, {id: 'code', icon: Code}].map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}><tab.icon size={16} /> <span className="capitalize">{tab.id === 'code' ? 'SQL' : tab.id}</span></button>
                ))}
              </div>
              <div className="relative w-full md:w-96 group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">{aiLoading ? <Loader2 size={16} className="text-indigo-600 animate-spin" /> : <Sparkles size={16} className="text-indigo-500 group-focus-within:text-indigo-600 transition-colors" />}</div>
                  <input type="text" placeholder='Ask AI (e.g. "salaries above 5000")' value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={handleAskAI} className="block w-full pl-10 pr-10 py-2 border-0 bg-indigo-50/50 rounded-xl text-slate-900 placeholder-indigo-300 focus:ring-2 focus:ring-indigo-500 sm:text-sm transition-all focus:bg-white" />
                  {searchQuery && (<button onClick={() => setSearchQuery('')} className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"><X size={14} /></button>)}
                  {aiError && (<div className="absolute top-full left-0 right-0 mt-2 p-2 bg-indigo-900 text-white text-xs rounded-lg shadow-lg z-50 animate-fade-in-up text-center">{aiError}</div>)}
              </div>
            </div>

            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center col-span-1 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10"><Activity size={100} /></div>
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Data Quality</h3>
                        <GaugeChart score={data.insights.quality_score} />
                    </div>
                    <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-4">
                        <StatCard title="Clean Rows" value={data.insights.rows_cleaned} icon={CheckCircle} color={{bg:'bg-emerald-100', text:'text-emerald-600'}} />
                        <StatCard title="Duplicates" value={data.insights.duplicates_removed} icon={Copy} color={{bg:'bg-blue-100', text:'text-blue-600'}} />
                        <StatCard title="Anomalies" value={data.insights.anomalies_detected} icon={AlertTriangle} color={{bg:'bg-amber-100', text:'text-amber-600'}} />
                        <StatCard title="PII Masked" value={data.insights.pii_masked} icon={UserX} color={{bg:'bg-rose-100', text:'text-rose-600'}} />
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                    <div className="flex items-center space-x-2 mb-4"><div className="p-2 bg-indigo-50 rounded-lg text-indigo-600"><FileText size={20} /></div><h3 className="text-lg font-bold text-slate-800">AI Analysis Summary</h3></div>
                    <p className="text-slate-600 leading-relaxed">{data.insights.summary}</p>
                    <div className="mt-8"><h4 className="font-bold text-xs text-slate-400 uppercase tracking-wider mb-3">Transformation Logs</h4><div className="bg-slate-50 rounded-xl p-4 h-40 overflow-y-auto text-xs font-mono text-slate-500 space-y-2 custom-scrollbar border border-slate-100">{data.insights.logs.map((log, i) => (<div key={i} className="flex items-start space-x-2"><span className="text-indigo-400">›</span><span>{log}</span></div>))}</div></div>
                  </div>
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
                    <h3 className="text-sm font-bold text-slate-800 mb-4">Row Composition</h3>
                    <div className="flex-1 w-full min-h-[200px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: 'Clean', value: data.insights.rows_cleaned }, { name: 'Dupes', value: data.insights.duplicates_removed }, { name: 'Anom', value: data.insights.anomalies_detected }]} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={5} dataKey="value">{COLORS.map((color, index) => <Cell key={`cell-${index}`} fill={color} />)}</Pie><Tooltip contentStyle={{borderRadius: '8px', border:'none', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}} /><Legend verticalAlign="bottom" iconType="circle"/></PieChart></ResponsiveContainer></div>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'details' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between"><div><h3 className="text-xl font-bold text-slate-800">Column Metadata</h3><p className="text-slate-500 text-sm">Detailed statistics for each field.</p></div></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">{data.insights.column_stats?.map((col, i) => (<ColumnCard key={i} col={col} />)) || <p className="text-slate-400 col-span-full italic">No column details available.</p>}</div>
                </div>
            )}

            {activeTab === 'data' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[600px]"><DataTable data={data.preview_original} title="Original" color="bg-rose-50 text-rose-700" /><DataTable data={filteredData} title={searchQuery ? "Filtered Result" : "Cleaned Data"} color="bg-emerald-50 text-emerald-700" /></div>
            )}

            {activeTab === 'charts' && (
               <div className="space-y-6">
                   <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                      <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
                        <div><h3 className="text-lg font-bold text-slate-800">Visual Insights</h3><p className="text-slate-400 text-xs">Analyze distribution and relationships.</p></div>
                        <div className="flex flex-wrap items-center gap-3 bg-slate-50 p-1.5 rounded-xl border border-slate-100">
                          <select value={selectedColumn} onChange={(e) => setSelectedColumn(e.target.value)} className="bg-white border-0 text-slate-700 text-sm rounded-lg p-2 outline-none font-bold shadow-sm focus:ring-2 focus:ring-indigo-500">{data.insights.numeric_columns.map(c => <option key={c} value={c}>{c}</option>)}</select>
                          {chartType === 'Scatter' && (<><span className="text-slate-400 text-xs font-bold px-1">vs</span><select value={yColumn} onChange={(e) => setYColumn(e.target.value)} className="bg-white border-0 text-slate-700 text-sm rounded-lg p-2 outline-none font-bold shadow-sm focus:ring-2 focus:ring-indigo-500">{data.insights.numeric_columns.map(c => <option key={c} value={c}>{c}</option>)}</select></>)}
                          <div className="w-px bg-slate-200 my-1 h-6"></div>
                          <button onClick={() => setChartType('Bar')} className={`p-2 rounded-lg transition-all ${chartType === 'Bar' ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`} title="Bar Chart"><BarChart3 size={18}/></button>
                          <button onClick={() => setChartType('Line')} className={`p-2 rounded-lg transition-all ${chartType === 'Line' ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`} title="Line Chart"><LineIcon size={18}/></button>
                          <button onClick={() => setChartType('Scatter')} className={`p-2 rounded-lg transition-all ${chartType === 'Scatter' ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`} title="Scatter Plot"><ScatterIcon size={18}/></button>
                        </div>
                      </div>
                      <div className="h-96 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          {chartType === 'Bar' ? (<BarChart data={filteredData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="index" tickLine={false} axisLine={false} tick={{fill: '#94a3b8', fontSize: 10}} /><YAxis tickLine={false} axisLine={false} tick={{fill: '#94a3b8', fontSize: 10}} /><Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '8px', border:'none', boxShadow:'0 10px 15px -3px rgba(0, 0, 0, 0.1)'}} /><Bar dataKey={selectedColumn} fill="#6366f1" radius={[4,4,0,0]} /></BarChart>) 
                          : chartType === 'Line' ? (<LineChart data={filteredData}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="index" tickLine={false} axisLine={false} tick={{fill: '#94a3b8', fontSize: 10}} /><YAxis tickLine={false} axisLine={false} tick={{fill: '#94a3b8', fontSize: 10}} /><Tooltip contentStyle={{borderRadius: '8px', border:'none', boxShadow:'0 10px 15px -3px rgba(0, 0, 0, 0.1)'}} /><Line type="monotone" dataKey={selectedColumn} stroke="#6366f1" strokeWidth={3} dot={{r:0}} activeDot={{r:6, fill:'#4f46e5'}} /></LineChart>)
                          : (<ScatterChart><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis type="number" dataKey={selectedColumn} name={selectedColumn} tick={{fill: '#94a3b8', fontSize: 10}} axisLine={false} tickLine={false} /><YAxis type="number" dataKey={yColumn} name={yColumn} tick={{fill: '#94a3b8', fontSize: 10}} axisLine={false} tickLine={false} /><ZAxis type="number" range={[50, 400]} /><Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{borderRadius: '8px', border:'none', boxShadow:'0 10px 15px -3px rgba(0, 0, 0, 0.1)'}} /><Scatter name="Data" data={filteredData} fill="#8884d8">{filteredData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}</Scatter></ScatterChart>)}
                        </ResponsiveContainer>
                      </div>
                   </div>
                   <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200"><div className="mb-6"><h3 className="text-lg font-bold text-slate-800">Correlation Matrix</h3><p className="text-slate-400 text-xs">Heatmap showing relationships between numeric variables.</p></div><CorrelationHeatmap matrix={data.insights.correlation_matrix} /></div>
               </div>
            )}

            {activeTab === 'code' && (
              <div className="bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-800 flex flex-col h-[500px]">
                <div className="flex justify-between items-center px-6 py-4 bg-slate-950/50 border-b border-slate-800"><div className="flex items-center space-x-3"><Database className="text-emerald-400" size={20} /><span className="text-slate-100 font-mono font-bold text-sm">cleaned_data_schema.sql</span></div><button onClick={copyToClipboard} className="flex items-center space-x-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold uppercase transition-colors"><Copy size={14} /> <span id="copy-btn-text">Copy SQL</span></button></div>
                <div className="p-6 overflow-auto custom-scrollbar flex-1"><pre className="font-mono text-xs md:text-sm text-slate-300 leading-relaxed">{data.insights.generated_sql}</pre></div>
              </div>
            )}

            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 rounded-2xl shadow-lg text-white flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left"><h3 className="text-2xl font-bold">Ready to Export?</h3><p className="text-indigo-100 opacity-90">Download your clean, standardized dataset in your preferred format.</p></div>
              <div className="flex flex-wrap justify-center gap-3">
                <button onClick={() => downloadFile('csv')} className="flex items-center space-x-2 px-6 py-3 bg-white text-indigo-700 rounded-xl font-bold hover:bg-indigo-50 transition-colors shadow-lg"><FileSpreadsheet size={20} /> <span>CSV</span></button>
                <button onClick={() => downloadFile('json')} className="flex items-center space-x-2 px-6 py-3 bg-indigo-500/30 backdrop-blur text-white rounded-xl font-bold border border-white/20 hover:bg-indigo-500/50 transition-colors"><Code size={20} /> <span>JSON</span></button>
                <button onClick={() => downloadFile('sql')} className="flex items-center space-x-2 px-6 py-3 bg-indigo-500/30 backdrop-blur text-white rounded-xl font-bold border border-white/20 hover:bg-indigo-500/50 transition-colors"><Database size={20} /> <span>SQL</span></button>
                {/* NEW PDF BUTTON */}
                <button onClick={() => downloadFile('pdf')} className="flex items-center space-x-2 px-6 py-3 bg-rose-500/30 backdrop-blur text-white rounded-xl font-bold border border-white/20 hover:bg-rose-500/50 transition-colors"><PdfIcon size={20} /> <span>Report</span></button>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}

export default App;