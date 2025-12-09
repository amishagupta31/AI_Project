import React, { useState } from 'react';
import axios from 'axios';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Upload, Download, FileText, AlertTriangle, CheckCircle, Loader, BarChart3, LineChart as LineIcon } from 'lucide-react';

// NOTE: External CSS file is removed. All styling is done using Tailwind CSS classes.

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [requestId, setRequestId] = useState(null);
  const [selectedColumn, setSelectedColumn] = useState('');
  // New state to manage the currently displayed chart type
  const [chartType, setChartType] = useState('Bar'); 

  // Function for basic exponential backoff retry logic (optional but good practice)
  const fetchWithRetry = async (url, options, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await axios(url, options);
        return response;
      } catch (error) {
        if (i < maxRetries - 1) {
          // Wait for 2^i seconds before retrying
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        } else {
          throw error;
        }
      }
    }
  };


  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setData(null); // Clear previous data
    setRequestId(null);
    setSelectedColumn('');
    setChartType('Bar'); // Reset chart type on new upload
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      // Use fetchWithRetry for robust API call
      const response = await fetchWithRetry({
        method: 'post',
        url: 'http://localhost:8000/upload',
        data: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const responseData = response.data;
      setData(responseData);
      setRequestId(responseData.request_id);
      
      // Auto-select first numeric column for the chart
      if (responseData.insights.numeric_columns.length > 0) {
        setSelectedColumn(responseData.insights.numeric_columns[0]);
      }
    } catch (error) {
      // Use a custom message box instead of alert()
      console.error("Error processing file:", error);
      // Implement a simple modal or inline message box here for user feedback
      alert("Error processing file. Please ensure the backend server is running and the file format is correct (CSV/XLSX).");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (requestId) window.location.href = `http://localhost:8000/download/${requestId}`;
  };

  const QualityIndicator = ({ score }) => {
    let colorClass, text;
    if (score > 85) {
      colorClass = "text-emerald-500 bg-emerald-50";
      text = "Excellent";
    } else if (score > 60) {
      colorClass = "text-yellow-500 bg-yellow-50";
      text = "Good";
    } else {
      colorClass = "text-red-500 bg-red-50";
      text = "Poor";
    }

    return (
      <div className={`p-1.5 rounded-full font-medium text-sm ${colorClass}`}>
        {text} ({score}%)
      </div>
    );
  };
  
  const StatCard = ({ title, value, icon, iconColor, valueColor = 'text-gray-900' }) => (
    <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100 transition-all hover:shadow-2xl">
      <div className="flex items-center space-x-3 mb-2">
        {React.cloneElement(icon, { size: 24, className: iconColor })}
        <h3 className="text-lg font-semibold text-gray-600">{title}</h3>
      </div>
      <p className={`text-4xl font-extrabold ${valueColor}`}>{value}</p>
    </div>
  );
  
  // New component function for chart rendering and selection logic
  const ChartDisplay = () => {
    if (!data || !data.insights.numeric_columns || data.insights.numeric_columns.length === 0) {
        return (
            <div className="flex h-72 items-center justify-center text-gray-500">
                No numeric data found to plot.
            </div>
        );
    }

    // Determine which Recharts component and series component to use
    const ChartComponent = chartType === 'Bar' ? BarChart : LineChart;
    const SeriesComponent = chartType === 'Bar' ? Bar : Line;

    return (
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-xl border border-gray-100">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 border-b pb-4">
                <h4 className="text-xl font-bold text-gray-800">Distribution Analysis</h4>
                <div className="flex items-center space-x-4 mt-3 sm:mt-0">
                    {/* Chart Type Selector */}
                    <div className="inline-flex rounded-md shadow-sm">
                        <button
                            onClick={() => setChartType('Bar')}
                            className={`p-2 rounded-l-lg text-sm font-medium ${chartType === 'Bar' ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition-all flex items-center`}
                            title="Bar Chart"
                        >
                            <BarChart3 size={16} className="mr-1" /> Bar
                        </button>
                        <button
                            onClick={() => setChartType('Line')}
                            className={`p-2 rounded-r-lg text-sm font-medium ${chartType === 'Line' ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition-all flex items-center`}
                            title="Line Chart"
                        >
                            <LineIcon size={16} className="mr-1" /> Line
                        </button>
                    </div>

                    {/* Column Selector */}
                    <select
                        value={selectedColumn}
                        onChange={(e) => setSelectedColumn(e.target.value)}
                        className="p-2 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        {data.insights.numeric_columns.map(col => (
                            <option key={col} value={col}>{col}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                    <ChartComponent data={data.chart_data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="index" stroke="#6b7280" tickLine={false} />
                        <YAxis stroke="#6b7280" tickLine={false} />
                        <Tooltip
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}
                            labelStyle={{ fontWeight: 'bold' }}
                        />
                        <SeriesComponent
                            dataKey={selectedColumn}
                            fill={chartType === 'Bar' ? "#6366f1" : "none"} // Bar fill
                            stroke={chartType === 'Line' ? "#6366f1" : "none"} // Line stroke
                            type="monotone" // Smooth line chart
                            dot={chartType === 'Line'} // Show dots on line chart
                            radius={chartType === 'Bar' ? [4, 4, 0, 0] : undefined} // Rounded corners for Bar
                            name={selectedColumn}
                        />
                    </ChartComponent>
                </ResponsiveContainer>
            </div>
        </div>
    );
  };


  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-10 lg:p-12 font-sans antialiased">
      <header className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-gray-900 mb-2">
          <span className="text-indigo-600">AI</span> Data Cleaner &amp; Insights
        </h1>
        <p className="text-lg text-gray-500">Intelligent cleaning and analysis for raw datasets.</p>
      </header>

      {/* Upload/Action Box */}
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-center gap-4 p-6 bg-white border border-gray-200 rounded-2xl shadow-xl">
        <div className="flex-1 w-full">
            <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700 mb-1">Upload CSV or XLSX file</label>
            <input 
                id="file-upload"
                type="file" 
                onChange={(e) => setFile(e.target.files[0])} 
                accept=".csv,.xlsx" 
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 
                file:rounded-full file:border-0 file:text-sm file:font-semibold
                file:bg-indigo-50 file:text-indigo-700
                hover:file:bg-indigo-100 cursor-pointer"
            />
        </div>
        
        <button 
          onClick={handleUpload} 
          disabled={loading || !file} 
          className="w-full md:w-auto flex items-center justify-center space-x-2 px-8 py-3 bg-indigo-600 text-white font-semibold rounded-xl shadow-md shadow-indigo-300 hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-100"
        >
          {loading ? (
            <>
              <Loader size={18} className="animate-spin" /> 
              <span>Processing AI...</span>
            </>
          ) : (
            <>
              <Upload size={18}/> 
              <span>Analyze & Clean</span>
            </>
          )}
        </button>
      </div>

      {/* Dashboard Results */}
      {data && (
        <div className="max-w-6xl mx-auto mt-12 space-y-10">
          
          {/* 1. Summary Block */}
          <div className="p-8 bg-white border-l-4 border-indigo-500 rounded-2xl shadow-xl">
            <h4 className="text-2xl font-bold text-gray-800 mb-4 flex items-center space-x-2">
                <FileText className="text-indigo-500" size={24} />
                <span>AI Analysis Report</span>
            </h4>
            <p className="text-gray-600 leading-relaxed">{data.insights.summary}</p>
          </div>

          {/* 2. Key Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard 
              title="Quality Score" 
              value={<QualityIndicator score={data.insights.quality_score} />} 
              icon={<CheckCircle />} 
              iconColor="text-indigo-500" 
              valueColor="text-gray-900" 
            />
            <StatCard 
              title="Cleaned Rows" 
              value={data.insights.rows_cleaned} 
              icon={<CheckCircle />} 
              iconColor="text-emerald-500" 
              valueColor="text-gray-900" 
            />
            <StatCard 
              title="Anomalies Detected" 
              value={data.insights.anomalies_detected} 
              icon={<AlertTriangle />} 
              iconColor="text-yellow-500" 
              valueColor="text-gray-900" 
            />
            <StatCard 
              title="Original Records" 
              value={data.insights.original_row_count} 
              icon={<FileText />} 
              iconColor="text-sky-500" 
              valueColor="text-gray-900" 
            />
          </div>

          {/* 3. Dynamic Charts and Logs */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Chart Box - Now uses ChartDisplay component */}
            <ChartDisplay />

            {/* Processing Logs */}
            <div className="lg:col-span-1 bg-gray-900 text-gray-100 p-6 rounded-2xl shadow-xl">
                <h4 className="text-xl font-bold text-indigo-400 mb-4 border-b border-gray-700 pb-3">Processing Logs</h4>
                <div className="h-64 overflow-y-auto space-y-2 text-sm custom-scrollbar">
                    {/* Inline custom styles for scrollbar on webkit browsers for a dark theme */}
                    <style>{`
                      .custom-scrollbar::-webkit-scrollbar { width: 8px; }
                      .custom-scrollbar::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 10px; }
                      .custom-scrollbar::-webkit-scrollbar-track { background: #1f2937; }
                    `}</style>
                    <ul className="list-none p-0 space-y-2">
                        {data.insights.logs.map((l, i) => (
                          <li key={i} className="flex items-start text-gray-300">
                            <span className="flex-shrink-0 mr-2 text-indigo-400">»</span>
                            <span className="break-words">{l}</span>
                          </li>
                        ))}
                    </ul>
                </div>
            </div>
          </div>

          {/* Download Button */}
          <button 
            className="w-full flex items-center justify-center space-x-3 px-6 py-4 bg-emerald-500 text-white font-bold text-xl rounded-2xl shadow-2xl shadow-emerald-300 hover:bg-emerald-600 transition-colors transform hover:scale-[1.01] active:scale-100" 
            onClick={handleDownload}
          >
            <Download size={22}/> 
            <span>Download Cleaned Dataset</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default App;