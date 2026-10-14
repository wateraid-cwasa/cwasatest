import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  ApiConnectionError,
  ApiRequestError,
  ApiResponseError,
  getCurrentUser,
  getStoredAccessToken,
  getStoredAuthenticatedUser,
  persistAuthenticatedUser,
  type AuthenticatedUser,
} from './api';

type ProfileError =
  | { type: 'connection' }
  | { type: 'request'; status: number }
  | { type: 'invalid' }
  | { type: 'unexpected'; message: string };

function isProfileError(value: unknown): value is ProfileError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value.type === 'connection' ||
      value.type === 'invalid' ||
      (value.type === 'request' && 'status' in value && typeof value.status === 'number') ||
      (value.type === 'unexpected' && 'message' in value && typeof value.message === 'string'))
  );
}

type AuthState = {
  user: AuthenticatedUser | null;
  profileStatus: 'idle' | 'loading' | 'succeeded' | 'failed';
  profileError: ProfileError | null;
};

const initialState: AuthState = {
  user: null,
  profileStatus: 'idle',
  profileError: null,
};

export const restoreSession = createAsyncThunk(
  'auth/restoreSession',
  async (): Promise<AuthenticatedUser | null> => {
    const accessToken = await getStoredAccessToken();
    if (!accessToken) return null;
    const storedUser = await getStoredAuthenticatedUser();
    if (storedUser) return storedUser;

    const currentUser = await getCurrentUser();
    const restoredUser: AuthenticatedUser = {
      ...currentUser,
      meterReaderId: '',
      readerCode: '',
    };
    await persistAuthenticatedUser(restoredUser);
    return restoredUser;
  },
);

export const fetchCurrentUser = createAsyncThunk(
  'auth/fetchCurrentUser',
  async (_, { rejectWithValue }) => {
    try {
      const currentUser = await getCurrentUser();
      const storedUser = await getStoredAuthenticatedUser();
      if (storedUser?.id === currentUser.id) {
        await persistAuthenticatedUser({
          ...storedUser,
          name: currentUser.name,
          role: currentUser.role,
        });
      }
      return currentUser;
    } catch (error) {
      if (error instanceof ApiConnectionError) {
        return rejectWithValue({ type: 'connection' } satisfies ProfileError);
      }
      if (error instanceof ApiRequestError) {
        return rejectWithValue({ type: 'request', status: error.status } satisfies ProfileError);
      }
      if (error instanceof ApiResponseError) {
        return rejectWithValue({ type: 'invalid' } satisfies ProfileError);
      }
      return rejectWithValue({
        type: 'unexpected',
        message: error instanceof Error ? error.message : String(error),
      } satisfies ProfileError);
    }
  },
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setAuthenticatedUser(state, action: PayloadAction<AuthenticatedUser>) {
      state.user = action.payload;
      state.profileStatus = 'idle';
      state.profileError = null;
    },
    clearAuthenticatedUser() {
      return initialState;
    },
  },
  extraReducers(builder) {
    builder
      .addCase(restoreSession.fulfilled, (state, action) => {
        state.user = action.payload;
        state.profileStatus = 'idle';
        state.profileError = null;
      })
      .addCase(fetchCurrentUser.pending, (state) => {
        state.profileStatus = 'loading';
        state.profileError = null;
      })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        if (!state.user || state.user.id !== action.payload.id) {
          state.profileStatus = 'failed';
          state.profileError = { type: 'invalid' };
          return;
        }
        state.user.name = action.payload.name;
        state.user.role = action.payload.role;
        state.profileStatus = 'succeeded';
        state.profileError = null;
      })
      .addCase(fetchCurrentUser.rejected, (state, action) => {
        state.profileStatus = 'failed';
        state.profileError = isProfileError(action.payload) ? action.payload : null;
      });
  },
});

export const { clearAuthenticatedUser, setAuthenticatedUser } = authSlice.actions;
export default authSlice.reducer;
