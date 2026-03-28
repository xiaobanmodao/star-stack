import { createContext, useContext } from 'react'
import type { AppContextType } from '../types'

export const AppContext = createContext<AppContextType>(null!)

export const useAppContext = () => useContext(AppContext)
