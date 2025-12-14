import React, { useState, useMemo } from 'react';
import axios from 'axios';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  Upload, Download, FileText, AlertTriangle, CheckCircle, Loader2, 
  BarChart3, LineChart as LineIcon, ShieldCheck, Database, LayoutDashboard, Code, Copy, 
  ArrowRight, Filter, Trash2, UserX, Table, PieChart as PieIcon, Activity, ArrowUpDown, Search, X
} from 'lucide-react';

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [requestId, setRequestId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview'); 
  const [selectedColumn, setSelectedColumn] = useState('');
  const [chartType, setChartType] = useState('Bar');
  const [maskPii, setMaskPii] = useState(true);
  
  // --- NEW STATE: Search Query ---
  const [searchQuery, setSearchQuery] = useState('');

  // Colors for Charts
  const COLORS = ['#6366f1', '#fbbf24', '#f43f5e']; 
  const GAUGE_COLORS = ['#ef4444', '#eab308', '#22c55e'];

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setData(null);
    setSearchQuery(''); // Reset search on new upload
    setActiveTab('overview');
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mask_pii', maskPii);

    try {
      const response = await axios.post('http://localhost:8000/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setData(response.data);
      setRequestId(response.data.request_id);
      
      if (response.data.insights.numeric_columns.length > 0) {
        const numericCols = response.data.insights.numeric_columns;
        const priorityCol = numericCols.find(col => 
            ['salary', 'age', 'amount', 'price', 'score', 'rating', 'total', 'profit', 'cost'].includes(col.toLowerCase())
        );
        setSelectedColumn(priorityCol || numericCols[0]);
      }
    } catch (error) {
      console.error(error);
      alert("Error processing file. Please ensure the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = (format) => {
    if (requestId) {
      window.location.href = `http://localhost:8000/download/${requestId}?format=${format}`;
    }
  };

  const copyToClipboard = () => {
    if(data?.insights?.generated_sql) {
        navigator.clipboard.writeText(data.insights.generated_sql);
        alert("SQL Code copied to clipboard!");
    }
  };

  // --- LOGIC: Filter Data based on Search Query ---
  const filteredData = useMemo(() => {
    if (!data || !data.preview_cleaned) return [];
    if (!searchQuery.trim()) return data.preview_cleaned;

    const query = searchQuery.toLowerCase();
    
    return data.preview_cleaned.filter(row => {
        // 1. Simple Text Search: Check if any value contains the search string
        const simpleMatch = Object.values(row).some(val => 
            String(val).toLowerCase().includes(query)
        );
        if (simpleMatch) return true;

        // 2. Advanced Operator Search (e.g., "age > 30")
        // Basic parser for ">", "<", "="
        try {
            if (query.includes('>')) {
                const [col, val] = query.split('>').map(s => s.trim());
                if (row[col] !== undefined && Number(row[col]) > Number(val)) return true;
            }
            if (query.includes('<')) {
                const [col, val] = query.split('<').map(s => s.trim());
                if (row[col] !== undefined && Number(row[col]) < Number(val)) return true;
            }
            if (query.includes('=')) {
                const [col, val] = query.split('=').map(s => s.trim());
                if (row[col] !== undefined && String(row[col]).toLowerCase() === val) return true;
            }
        } catch (e) {
            return false;
        }
        return false;
    });
  }, [data, searchQuery]);

  // --- COMPONENT: Gauge Chart ---
  const GaugeChart = ({ score }) => {
    let color = GAUGE_COLORS[0];
    if (score > 50) color = GAUGE_COLORS[1];
    if (score > 80) color = GAUGE_COLORS[2];

    const pieData = [
      { name: 'Score', value: score },
      { name: 'Remaining', value: 100 - score }
    ];
    
    return (
        <div className="relative w-48 h-24 mx-auto overflow-hidden">
             <ResponsiveContainer width="100%" height="200%">
                <PieChart>
                    <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        startAngle={180}
                        endAngle={0}
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={0}
                        dataKey="value"
                    >
                        <Cell key="score" fill={color} />
                        <Cell key="rest" fill="#f1f5f9" />
                    </Pie>
                </PieChart>
             </ResponsiveContainer>
             <div className="absolute bottom-0 w-full text-center">
                 <p className="text-3xl font-extrabold text-slate-800">{score}%</p>
                 <p className="text-xs text-slate-400 font-bold uppercase">Health Score</p>
             </div>
        </div>
    );
  };

  // --- COMPONENT: Correlation Heatmap ---
  const CorrelationHeatmap = ({ matrix }) => {
    if (!matrix || matrix.length === 0) return <div className="text-center text-slate-400 py-10">No numeric correlations found.</div>;
    const keys = [...new Set(matrix.map(m => m.x))];
    
    return (
        <div className="overflow-x-auto">
            <div className="min-w-[500px]">
                <div className="grid" style={{ gridTemplateColumns: `50px repeat(${keys.length}, 1fr)` }}>
                    <div className="h-10"></div>
                    {keys.map(k => (
                        <div key={k} className="h-10 flex items-center justify-center font-bold text-xs text-slate-500">{k}</div>
                    ))}
                    {keys.map(y => (
                        <React.Fragment key={y}>
                            <div className="h-12 flex items-center justify-end pr-2 font-bold text-xs text-slate-500">{y}</div>
                            {keys.map(x => {
                                const item = matrix.find(m => m.x === x && m.y === y);
                                const val = item ? item.value : 0;
                                let bg = '#fff';
                                if (val > 0) bg = `rgba(99, 102, 241, ${val})`; 
                                if (val < 0) bg = `rgba(244, 63, 94, ${Math.abs(val)})`; 
                                return (
                                    <div key={`${x}-${y}`} className="h-12 border border-slate-50 flex items-center justify-center text-xs font-medium" style={{ backgroundColor: bg }}>
                                        {val}
                                    </div>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        </div>
    );
  };

  // --- COMPONENT: Sortable Table ---
  const DataTable = ({ data, title, color }) => {
    if (!data || data.length === 0) return <div className="p-8 text-center text-slate-400 italic">No data matches your search.</div>;
    const [sortConfig, setSortConfig] = useState(null);
    const columns = Object.keys(data[0]);

    const sortedData = React.useMemo(() => {
        let sortableItems = [...data];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [data, sortConfig]);

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex-1 flex flex-col h-full">
        <div className={`p-4 border-b border-slate-100 font-bold text-slate-700 flex items-center space-x-2 ${color}`}>
          <Database size={16} /> <span>{title} ({data.length} rows)</span>
        </div>
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-sm text-left text-slate-600">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
              <tr>
                {columns.map(col => (
                    <th key={col} className="px-4 py-3 font-semibold cursor-pointer hover:bg-slate-100 transition-colors group" onClick={() => requestSort(col)}>
                        <div className="flex items-center space-x-1">
                            <span>{col}</span>
                            <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-50" />
                        </div>
                    </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((row, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  {columns.map(col => (
                    <td key={col} className="px-4 py-3 font-medium whitespace-nowrap">
                      {row[col] !== null ? String(row[col]) : <span className="text-red-300 italic text-xs">null</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const StatCard = ({ title, value, subtext, icon: Icon, color }) => (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300 group">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-xl ${color.bg} group-hover:scale-110 transition-transform`}>
          <Icon size={24} className={color.text} />
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${color.bg} ${color.text} uppercase tracking-wider`}>{title}</span>
      </div>
      <div className="space-y-1">
        <h3 className="text-3xl font-bold text-slate-800 tracking-tight">{value}</h3>
        {subtext && <p className="text-xs text-slate-500 font-medium">{subtext}</p>}
      </div>
    </div>
  );

  const ColumnCard = ({ col }) => (
    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:border-indigo-100 hover:shadow-md transition-all">
        <div className="flex justify-between items-start mb-3">
            <h4 className="font-bold text-slate-800 truncate" title={col.name}>{col.name}</h4>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${col.type === 'Numeric' ? 'bg-blue-50 text-blue-600' : col.type === 'Date' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>{col.type}</span>
        </div>
        <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Missing</span><span className={`font-semibold ${col.missing > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>{col.missing}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Unique</span><span className="font-semibold text-slate-700">{col.unique}</span></div>
            <div className="pt-2 border-t border-slate-50 mt-2"><p className="text-xs text-slate-400 mb-1">Sample Value</p><p className="font-mono text-xs text-slate-600 truncate bg-slate-50 p-1 rounded">{col.sample}</p></div>
        </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100 selection:text-indigo-700">
      
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center space-x-2">
          <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-2 rounded-xl shadow-lg shadow-indigo-200">
            <Database className="text-white" size={24} />
          </div>
          <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-700 to-purple-700">InfoPulse <span className="font-extrabold">AI</span></span>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6 md:p-10 space-y-10">
        
        {/* Upload Header */}
        {!data && (
            <section className="text-center space-y-8 py-20">
            <h1 className="text-5xl md:text-6xl font-extrabold text-slate-900 tracking-tight leading-tight">
                Data Cleaning <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500">Reimagined with AI</span>
            </h1>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
                Upload messy CSV or Excel files. Watch our AI detect anomalies, fix typos, mask PII, and standardize formats in seconds.
            </p>

            <div className="max-w-xl mx-auto flex flex-col space-y-6">
                <div className="bg-white p-3 rounded-2xl shadow-2xl shadow-indigo-100 border border-slate-200 flex items-center space-x-3 transform transition-all hover:scale-[1.01]">
                <input 
                    type="file" 
                    onChange={(e) => setFile(e.target.files[0])}
                    accept=".csv,.xlsx"
                    className="flex-1 text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer pl-2"
                />
                <button 
                    onClick={handleUpload}
                    disabled={loading || !file}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:shadow-none flex items-center"
                >
                    {loading ? <Loader2 className="animate-spin mr-2" size={20} /> : <Upload className="mr-2" size={20} />}
                    Analyze
                </button>
                </div>

                <button 
                    onClick={() => setMaskPii(!maskPii)}
                    className={`self-center flex items-center space-x-2 px-5 py-2 rounded-full border text-sm font-semibold transition-all ${
                        maskPii 
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm' 
                        : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                    }`}
                >
                    <ShieldCheck size={16} className={maskPii ? 'text-emerald-500' : 'text-slate-400'} />
                    <span>{maskPii ? "PII Protection: Active" : "PII Protection: Disabled"}</span>
                </button>
            </div>
            </section>
        )}

        {data && (
          <div className="space-y-8 animate-fade-in-up">
            
            {/* --- TOP BAR: Tabs + Search --- */}
            <div className="flex flex-col md:flex-row justify-between items-center bg-white p-2 rounded-2xl shadow-sm border border-slate-200 gap-4">
              <div className="flex space-x-1 w-full md:w-auto overflow-x-auto">
                {['overview', 'details', 'data', 'charts', 'code'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all capitalize ${
                      activeTab === tab 
                      ? 'bg-slate-900 text-white shadow-lg' 
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    }`}
                  >
                    {tab === 'code' ? 'SQL Script' : tab === 'data' ? 'Compare' : tab}
                  </button>
                ))}
              </div>

              {/* SEARCH BAR (Ask Your Data) */}
              <div className="relative w-full md:w-96 group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Search size={18} className="text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                  </div>
                  <input 
                      type="text" 
                      placeholder='Ask data (e.g. "age > 25" or "John")' 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="block w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl leading-5 bg-slate-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-all"
                  />
                  {searchQuery && (
                      <button 
                        onClick={() => setSearchQuery('')}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                      >
                          <X size={16} />
                      </button>
                  )}
              </div>
            </div>

            {/* --- TAB CONTENT --- */}
            
            {activeTab === 'overview' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center col-span-1">
                        <GaugeChart score={data.insights.quality_score} />
                    </div>
                    <div className="col-span-1 md:col-span-2 grid grid-cols-2 gap-4">
                        <StatCard title="DUPLICATES" value={data.insights.duplicates_removed} subtext="Rows removed" icon={Copy} color={{bg:'bg-blue-100', text:'text-blue-600'}} />
                        <StatCard title="ANOMALIES" value={data.insights.anomalies_detected} subtext="Outliers detected" icon={AlertTriangle} color={{bg:'bg-amber-100', text:'text-amber-600'}} />
                        <StatCard title="PII DETECTED" value={data.insights.pii_masked} subtext="Fields secured" icon={UserX} color={{bg:'bg-rose-100', text:'text-rose-600'}} />
                        <StatCard title="TOTAL CLEANED" value={data.insights.rows_cleaned} subtext="Ready rows" icon={CheckCircle} color={{bg:'bg-emerald-100', text:'text-emerald-600'}} />
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center">
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Data Composition</h3>
                    <div className="w-full h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={[{ name: 'Cleaned', value: data.insights.rows_cleaned }, { name: 'Duplicates', value: data.insights.duplicates_removed }, { name: 'Anomalies', value: data.insights.anomalies_detected }]} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                    {COLORS.map((color, index) => <Cell key={`cell-${index}`} fill={color} />)}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom"/>
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800 mb-4">AI Analysis Report</h3>
                    <p className="text-slate-600 leading-relaxed text-lg">{data.insights.summary}</p>
                    <div className="mt-8 pt-6 border-t border-slate-100">
                         <h4 className="font-bold text-slate-800 mb-3 flex items-center"><Activity size={18} className="mr-2 text-indigo-500"/>Recent Logs</h4>
                         <div className="bg-slate-50 rounded-xl p-4 h-32 overflow-y-auto text-xs font-mono text-slate-600 space-y-2 custom-scrollbar">
                            {data.insights.logs.map((log, i) => <div key={i}>› {log}</div>)}
                         </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'details' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xl font-bold text-slate-800">Column Inspection</h3>
                        <p className="text-slate-500">Deep dive into specific field metrics</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {data.insights.column_stats?.map((col, i) => (
                            <ColumnCard key={i} col={col} />
                        )) || <p className="text-slate-400 col-span-full italic">No column details available. Please restart backend.</p>}
                    </div>
                </div>
            )}

            {activeTab === 'data' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[600px]">
                 <DataTable data={data.preview_original} title="Original Data (Raw)" color="bg-rose-50 text-rose-700" />
                 {/* Use filteredData for Cleaned Table */}
                 <DataTable data={filteredData} title={searchQuery ? `Filtered Result` : `Cleaned Data`} color="bg-emerald-50 text-emerald-700" />
              </div>
            )}

            {activeTab === 'charts' && (
               <div className="space-y-6">
                   <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                      <div className="flex justify-between items-center mb-8">
                        <div><h3 className="text-xl font-bold text-slate-800">Distribution Analysis</h3></div>
                        <div className="flex gap-4">
                          <select value={selectedColumn} onChange={(e) => setSelectedColumn(e.target.value)} className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-xl p-2.5 outline-none font-medium">
                            {data.insights.numeric_columns.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <div className="flex bg-slate-100 rounded-xl p-1">
                            <button onClick={() => setChartType('Bar')} className={`p-2 rounded-lg ${chartType === 'Bar' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}><BarChart3 size={20}/></button>
                            <button onClick={() => setChartType('Line')} className={`p-2 rounded-lg ${chartType === 'Line' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}><LineIcon size={20}/></button>
                          </div>
                        </div>
                      </div>
                      <div className="h-96 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          {chartType === 'Bar' ? (
                            // Use filteredData here too!
                            <BarChart data={filteredData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="index" tickLine={false} axisLine={false} />
                              <YAxis tickLine={false} axisLine={false} />
                              <Tooltip />
                              <Bar dataKey={selectedColumn} fill="#6366f1" radius={[6,6,0,0]} />
                            </BarChart>
                          ) : (
                            <LineChart data={filteredData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="index" tickLine={false} axisLine={false} />
                              <YAxis tickLine={false} axisLine={false} />
                              <Tooltip />
                              <Line type="monotone" dataKey={selectedColumn} stroke="#6366f1" strokeWidth={4} dot={{r:4}} />
                            </LineChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                   </div>

                   <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                        <h3 className="text-xl font-bold text-slate-800 mb-4">Correlation Matrix</h3>
                        <p className="text-slate-500 text-sm mb-6">Relationships between numeric variables</p>
                        <CorrelationHeatmap matrix={data.insights.correlation_matrix} />
                   </div>
               </div>
            )}

            {activeTab === 'code' && (
              <div className="bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-700">
                <div className="flex justify-between items-center px-6 py-4 bg-slate-800 border-b border-slate-700">
                  <div className="flex items-center space-x-3">
                    <Database className="text-emerald-400" size={20} />
                    <span className="text-slate-100 font-mono font-bold">cleaned_data.sql</span>
                  </div>
                  <button onClick={copyToClipboard} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold uppercase">
                    <Copy size={14} /> <span>Copy SQL</span>
                  </button>
                </div>
                <div className="p-6 overflow-x-auto">
                  <pre className="font-mono text-sm text-slate-300 leading-relaxed">{data.insights.generated_sql}</pre>
                </div>
              </div>
            )}

            <div className="bg-white p-8 rounded-2xl shadow-lg border border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left">
                <h3 className="text-xl font-bold text-slate-800">Ready to Export?</h3>
                <p className="text-slate-500">Download your clean, standardized dataset.</p>
              </div>
              <div className="flex gap-4">
                <button onClick={() => downloadFile('csv')} className="flex items-center space-x-2 px-6 py-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl font-bold border border-emerald-200">
                  <FileText size={20} /> <span>CSV</span>
                </button>
                <button onClick={() => downloadFile('json')} className="flex items-center space-x-2 px-6 py-3 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl font-bold border border-amber-200">
                  <Code size={20} /> <span>JSON</span>
                </button>
                <button onClick={() => downloadFile('sql')} className="flex items-center space-x-2 px-6 py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl font-bold border border-blue-200">
                  <Database size={20} /> <span>SQL</span>
                </button>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}

export default App;