'use client';

import React, { useState, useEffect } from 'react';
import type { StatusType } from '@/lib/contexts/StatusContext';

interface ProgressBarProps {
  isLoading: boolean;
  status: StatusType;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ isLoading, status }) => {
  const [dots, setDots] = useState('');
  
  // Create animated dots for loading states
  useEffect(() => {
    if (!isLoading) return;
    
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev.length >= 3) return '';
        return prev + '.';
      });
    }, 500);
    
    return () => clearInterval(interval);
  }, [isLoading]);
  
  // Map status to a user-friendly message
  const getStatusMessage = (): string => {
    switch (status) {
      case 'navigating':
        return 'Navigating to HungerRush';
      case 'logging-in':
        return 'Logging in to HungerRush';
      case 'navigating-to-reporting':
        return 'Navigating to Reporting';
      case 'selecting-store':
        return 'Selecting store';
      case 'running-report':
        return 'Running report';
      case 'exporting':
        return 'Exporting data';
      case 'processing':
        return 'Processing data';
      case 'completed':
        return 'Generation complete!';
      case 'error':
        return 'Error occurred';
      case 'idle':
      default:
        return 'Ready';
    }
  };
  
  // Calculate progress percentage based on status
  const getProgressPercentage = (): number => {
    switch (status) {
      case 'navigating':
        return 10;
      case 'logging-in':
        return 20;
      case 'navigating-to-reporting':
        return 30;
      case 'selecting-store':
        return 40;
      case 'running-report':
        return 50;
      case 'exporting':
        return 70;
      case 'processing':
        return 85;
      case 'completed':
        return 100;
      case 'error':
        return 100;
      case 'idle':
      default:
        return 0;
    }
  };
  
  // Don't render anything if not loading and status is idle
  if (!isLoading && status === 'idle') {
    return null;
  }
  
  const progressPercent = getProgressPercentage();
  const message = getStatusMessage();
  
  return (
    <div className="mt-6">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">
          {message}{isLoading ? dots : ''}
        </span>
        <span className="text-sm font-medium text-gray-700">{progressPercent}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div 
          className={`h-2.5 rounded-full ${status === 'error' ? 'bg-red-600' : 'bg-blue-600'}`}
          style={{ width: `${progressPercent}%`, transition: 'width 0.3s ease-in-out' }}
        ></div>
      </div>
    </div>
  );
};

export default ProgressBar; 