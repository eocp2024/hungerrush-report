"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useStatus } from '@/lib/contexts/StatusContext';
import ProgressBar from '@/app/components/ProgressBar';

interface SummaryData {
  cashSalesInStore: number;
  cashSalesDelivery: number;
  creditCardTipsInStore: number;
  creditCardTipsDelivery: number;
  totalOrders: number;
  averageOrderValue: number;
  _error?: string;
  _note?: string;
}

export default function Home() {
  const { status, isLoading, setStatus, startLoading, stopLoading, error, setError } = useStatus();
  
  // Store the date and time values separately to avoid timezone issues
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [pollIntervalId, setPollIntervalId] = useState<NodeJS.Timeout | null>(null);

  // Function to poll status
  const pollStatus = useCallback(async () => {
    if (!isLoading) return;
    
    try {
      const response = await fetch('/api/generate-summary', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.status && data.status !== 'idle') {
          setStatus(data.status as any);
        }
        
        // If the status is 'completed' or 'error', stop polling
        if (data.status === 'completed' || data.status === 'error') {
          if (pollIntervalId) {
            clearInterval(pollIntervalId);
            setPollIntervalId(null);
          }
        }
      }
    } catch (err) {
      console.error('Error polling status:', err);
    }
  }, [isLoading, pollIntervalId, setStatus]);

  // Set default time range to current date and time
  useEffect(() => {
    // Get current date and time in user's local timezone
    const today = new Date();
    
    // Format date as YYYY-MM-DD
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;
    
    console.log('Setting default date to:', formattedDate);
    
    // Format current time in HH:MM format (24-hour)
    const hours = today.getHours().toString().padStart(2, '0');
    const minutes = today.getMinutes().toString().padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;
    
    // Set start time to current time
    setStartDate(formattedDate);
    setStartTime(currentTime);
    
    // Set end time to current time + 1 hour
    const endTime = new Date(today);
    endTime.setHours(today.getHours() + 1);
    const endHours = endTime.getHours().toString().padStart(2, '0');
    const endMinutes = endTime.getMinutes().toString().padStart(2, '0');
    
    setEndDate(formattedDate);
    setEndTime(`${endHours}:${endMinutes}`);
  }, []);
  
  // Set up polling when loading starts and clean up when it stops
  useEffect(() => {
    if (isLoading && !pollIntervalId) {
      // Start polling every 2 seconds
      const intervalId = setInterval(pollStatus, 2000);
      setPollIntervalId(intervalId);
    } else if (!isLoading && pollIntervalId) {
      // Stop polling when loading is done
      clearInterval(pollIntervalId);
      setPollIntervalId(null);
    }
    
    // Clean up on component unmount
    return () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
      }
    };
  }, [isLoading, pollIntervalId, pollStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate inputs
    if (!startDate || !startTime || !endDate || !endTime) {
      setError('Please complete all date and time fields');
      return;
    }
    
    // Construct ISO strings with the user's exact selected values
    // This preserves the hours and minutes exactly as selected
    const startDateTime = `${startDate}T${startTime}:00.000Z`;
    const endDateTime = `${endDate}T${endTime}:00.000Z`;
    
    console.log('Submitting date range:', { startDateTime, endDateTime });
    
    // Start loading
    startLoading();
    setStatus('navigating');
    setSummaryData(null);
    
    try {
      // Call the API to generate the summary
      const response = await fetch('/api/generate-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ startDateTime, endDateTime }),
      });
      
      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }
      
      // Get the summary data
      const data = await response.json();
      setSummaryData(data);
      
      // Check for error in the response
      if (data._error) {
        setStatus('error');
        setError(data._error);
      } else {
        setStatus('completed');
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      stopLoading();
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  return (
    <main className="min-h-screen p-6 md:p-12 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-gray-800">HungerRush Sales Summary</h1>
        
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4 text-gray-700">Generate Summary</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
                  Start Date
                </label>
                <input
                  type="date"
                  id="startDate"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              
              <div>
                <label htmlFor="startTime" className="block text-sm font-medium text-gray-700">
                  Start Time
                </label>
                <input
                  type="time"
                  id="startTime"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              
      <div>
                <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
                  End Date
                </label>
                <input
                  type="date"
                  id="endDate"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
      </div>
              
      <div>
                <label htmlFor="endTime" className="block text-sm font-medium text-gray-700">
                  End Time
                </label>
                <input
                  type="time"
                  id="endTime"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
      </div>
            
            <div>
              <button
                type="submit"
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                disabled={isLoading}
              >
                {isLoading ? 'Generating...' : 'Generate Summary'}
              </button>
        </div>
          </form>
          
          {/* Progress Bar */}
          <ProgressBar isLoading={isLoading} status={status} />
          
          {/* Error Message */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600">{error}</p>
              {summaryData?._note && (
                <p className="text-gray-500 mt-2 text-sm">{summaryData._note}</p>
              )}
        </div>
          )}
        </div>
        
        {/* Results Section */}
        {summaryData && !error && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-700">Sales Summary</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-50 p-4 rounded-md">
                <h3 className="text-lg font-medium mb-2 text-gray-800">In-Store Sales</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Cash Sales:</span>
                    <span className="font-medium">{formatCurrency(summaryData.cashSalesInStore)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Credit Card Tips:</span>
                    <span className="font-medium">{formatCurrency(summaryData.creditCardTipsInStore)}</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-md">
                <h3 className="text-lg font-medium mb-2 text-gray-800">Delivery Sales</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Cash Sales:</span>
                    <span className="font-medium">{formatCurrency(summaryData.cashSalesDelivery)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Credit Card Tips:</span>
                    <span className="font-medium">{formatCurrency(summaryData.creditCardTipsDelivery)}</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Orders:</span>
                <span className="text-xl font-semibold">{summaryData.totalOrders}</span>
              </div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-gray-600">Average Order Value:</span>
                <span className="text-xl font-semibold">{formatCurrency(summaryData.averageOrderValue)}</span>
              </div>
            </div>
        </div>
        )}
      </div>
    </main>
  );
}
